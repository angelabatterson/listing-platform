"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { hasLiveSubscription, isPlanKey, priceIdFor } from "@/lib/billing/plans";
import { billingEnabled, stripe } from "@/lib/billing/stripe";

// Stripe only accepts a trial end at least two days away.
const MIN_TRIAL_MS = 2 * 86_400_000 + 3_600_000;

async function ownOrganization() {
  const user = await requireUser();
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, user.organizationId) });
  if (!org) throw new Error("Account not found");
  return { user, org };
}

async function portalUrl(customer: string): Promise<string> {
  const session = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${process.env.APP_URL}/billing`,
  });
  return session.url;
}

// Card details, invoices, plan changes and cancelling all happen in Stripe's portal.
export async function openBillingPortal() {
  const { org } = await ownOrganization();
  if (!billingEnabled() || !org.stripeCustomerId) redirect("/billing");
  redirect(await portalUrl(org.stripeCustomerId));
}

// Straight to Stripe's cancel confirmation. The plan keeps working until the end of
// the period already paid for, and Stripe's webhook then marks it cancelled.
export async function cancelSubscription() {
  const { org } = await ownOrganization();
  if (!billingEnabled() || !org.stripeCustomerId || !org.stripeSubscriptionId) redirect("/billing");
  const session = await stripe().billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${process.env.APP_URL}/billing`,
    flow_data: {
      type: "subscription_cancel",
      subscription_cancel: { subscription: org.stripeSubscriptionId },
      after_completion: { type: "redirect", redirect: { return_url: `${process.env.APP_URL}/billing?cancelled=1` } },
    },
  });
  redirect(session.url);
}

export async function choosePlan(plan: string) {
  const { user, org } = await ownOrganization();
  if (!billingEnabled() || !isPlanKey(plan)) redirect("/billing");
  const price = priceIdFor(plan);
  if (!price) throw new Error(`STRIPE_PRICE_${plan.toUpperCase()} isn't set`);

  // An account that's already subscribed changes plan in the portal, so it never ends
  // up paying for two subscriptions.
  if (org.stripeCustomerId && hasLiveSubscription(org.subscriptionStatus)) {
    redirect(await portalUrl(org.stripeCustomerId));
  }

  let customer = org.stripeCustomerId;
  if (!customer) {
    const created = await stripe().customers.create({
      email: user.email,
      name: org.name,
      metadata: { organizationId: org.id },
    });
    customer = created.id;
    await db.update(organizations).set({ stripeCustomerId: customer }).where(eq(organizations.id, org.id));
  }

  // Subscribing during the free trial keeps the remaining trial days: the first charge
  // waits until the trial ends. Accounts that subscribed before don't get it again.
  const keepTrial = org.subscriptionStatus === null && org.trialEndsAt.getTime() - Date.now() > MIN_TRIAL_MS;

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: org.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: {
      metadata: { organizationId: org.id },
      ...(keepTrial ? { trial_end: Math.floor(org.trialEndsAt.getTime() / 1000) } : {}),
    },
    allow_promotion_codes: true,
    success_url: `${process.env.APP_URL}/billing?checkout=done`,
    cancel_url: `${process.env.APP_URL}/billing`,
  });
  if (!session.url) throw new Error("Stripe didn't return a checkout link");
  redirect(session.url);
}
