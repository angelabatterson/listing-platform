import "server-only";
import { and, count, eq, gte } from "drizzle-orm";
import { cache } from "react";
import type Stripe from "stripe";
import { db } from "@/db";
import { aiDrafts, items, organizations } from "@/db/schema";
import type { CurrentUser } from "@/lib/auth";
import {
  accessFor,
  draftLimitMessage,
  hasLiveSubscription,
  inactiveMessage,
  listingLimitMessage,
  monthStart,
  planForPrice,
  type Access,
} from "./plans";
import { billingEnabled } from "./stripe";

// The app owner's own accounts, listed in BILLING_EXEMPT_EMAILS, never need a plan.
function isExempt(email: string): boolean {
  return (process.env.BILLING_EXEMPT_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .includes(email.toLowerCase());
}

const loadAccess = cache(async (organizationId: string, email: string): Promise<Access> => {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { trialEndsAt: true, subscriptionStatus: true, plan: true },
  });
  if (!org) throw new Error("Account not found");
  return accessFor(org, { enabled: billingEnabled(), exempt: isExempt(email) });
});

export function getAccess(user: CurrentUser): Promise<Access> {
  return loadAccess(user.organizationId, user.email);
}

export async function usage(organizationId: string) {
  const [[listings], [drafts]] = await Promise.all([
    db
      .select({ n: count() })
      .from(items)
      .where(and(eq(items.organizationId, organizationId), eq(items.status, "active"))),
    db
      .select({ n: count() })
      .from(aiDrafts)
      .where(and(eq(aiDrafts.organizationId, organizationId), gte(aiDrafts.createdAt, monthStart()))),
  ]);
  return { activeListings: listings.n, aiDraftsThisMonth: drafts.n };
}

// Each check returns a message for the seller when the action isn't allowed, or null.

export async function writeProblem(user: CurrentUser): Promise<string | null> {
  const access = await getAccess(user);
  return access.canWrite ? null : inactiveMessage(access);
}

// `adding` is how many items the action would make active.
export async function listingProblem(user: CurrentUser, adding = 1): Promise<string | null> {
  const access = await getAccess(user);
  if (!access.canWrite) return inactiveMessage(access);
  const cap = access.limits.activeListings;
  if (cap === null) return null;
  const { activeListings } = await usage(user.organizationId);
  return activeListings + adding > cap ? listingLimitMessage(access) : null;
}

export async function draftProblem(user: CurrentUser): Promise<string | null> {
  const access = await getAccess(user);
  if (!access.canWrite) return inactiveMessage(access);
  const cap = access.limits.aiDraftsPerMonth;
  if (cap === null) return null;
  const { aiDraftsThisMonth } = await usage(user.organizationId);
  return aiDraftsThisMonth >= cap ? draftLimitMessage(access) : null;
}

export async function recordAiDraft(organizationId: string) {
  await db.insert(aiDrafts).values({ organizationId });
}

// Copy a subscription's current state from Stripe onto its account. Webhooks can
// arrive out of order, so callers pass a subscription freshly fetched from Stripe.
export async function applySubscription(sub: Stripe.Subscription): Promise<boolean> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const org = await db.query.organizations.findFirst({
    where: sub.metadata.organizationId
      ? eq(organizations.id, sub.metadata.organizationId)
      : eq(organizations.stripeCustomerId, customerId),
    columns: { id: true, stripeSubscriptionId: true, subscriptionStatus: true },
  });
  if (!org) return false;
  // An old subscription ending mustn't overwrite a newer one that's still running.
  if (
    org.stripeSubscriptionId &&
    org.stripeSubscriptionId !== sub.id &&
    hasLiveSubscription(org.subscriptionStatus) &&
    !hasLiveSubscription(sub.status)
  ) {
    return false;
  }
  const item = sub.items.data[0];
  await db
    .update(organizations)
    .set({
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      plan: planForPrice(item?.price.id),
      currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end || sub.cancel_at !== null,
    })
    .where(eq(organizations.id, org.id));
  return true;
}
