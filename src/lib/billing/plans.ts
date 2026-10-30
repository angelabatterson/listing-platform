// Plans, their limits, and what an account may do given its subscription. Prices live
// in Stripe (one recurring price per plan, named by STRIPE_PRICE_<PLAN>), so they can
// change without a code change; the limits below are what the app enforces.

export const PLAN_KEYS = ["starter", "pro", "business"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

// null means unlimited. Photo batches always have a cap, since one batch is sorted
// and stored as a whole.
export type Limits = { activeListings: number | null; aiDraftsPerMonth: number | null; photosPerBatch: number };

export const PLANS: Record<PlanKey, { name: string; limits: Limits }> = {
  starter: { name: "Starter", limits: { activeListings: 100, aiDraftsPerMonth: 50, photosPerBatch: 250 } },
  pro: { name: "Pro", limits: { activeListings: 500, aiDraftsPerMonth: 300, photosPerBatch: 500 } },
  business: { name: "Business", limits: { activeListings: null, aiDraftsPerMonth: 1000, photosPerBatch: 1000 } },
};

export const TRIAL_DAYS = 14;
export const TRIAL_LIMITS: Limits = PLANS.starter.limits;
const UNLIMITED: Limits = { activeListings: null, aiDraftsPerMonth: null, photosPerBatch: 1000 };

// Stripe statuses that mean the subscription is paid up (or in a Stripe-side trial).
const PAID = new Set(["active", "trialing"]);

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

export function priceIdFor(plan: PlanKey): string | undefined {
  return process.env[`STRIPE_PRICE_${plan.toUpperCase()}`] || undefined;
}

export function planForPrice(priceId: string | undefined): PlanKey | null {
  if (!priceId) return null;
  return PLAN_KEYS.find((p) => priceIdFor(p) === priceId) ?? null;
}

export function hasLiveSubscription(status: string | null): boolean {
  return status !== null && (PAID.has(status) || status === "past_due");
}

export type BillingFields = {
  trialEndsAt: Date;
  subscriptionStatus: string | null;
  plan: string | null;
};

// free: billing is off (no Stripe key) or the account is exempt. past_due: Stripe is
// retrying a failed payment, so the account keeps working while the seller fixes it.
export type AccessState = "free" | "trial" | "active" | "past_due" | "inactive";

export type Access = {
  state: AccessState;
  canWrite: boolean;
  plan: PlanKey | null;
  limits: Limits;
  trialEndsAt: Date;
  // True once the account has had a subscription, so messages say "subscription"
  // rather than "trial".
  subscribedBefore: boolean;
};

export function accessFor(
  org: BillingFields,
  opts: { enabled: boolean; exempt: boolean },
  now = new Date(),
): Access {
  const base = { trialEndsAt: org.trialEndsAt, subscribedBefore: org.subscriptionStatus !== null };
  if (!opts.enabled || opts.exempt) return { ...base, state: "free", canWrite: true, plan: null, limits: UNLIMITED };
  const plan = isPlanKey(org.plan) ? org.plan : null;
  // A paying account whose Stripe price isn't one of STRIPE_PRICE_* (a setup mistake)
  // is never locked out; it just isn't capped.
  const limits = plan ? PLANS[plan].limits : UNLIMITED;
  if (org.subscriptionStatus && PAID.has(org.subscriptionStatus)) {
    return { ...base, state: "active", canWrite: true, plan, limits };
  }
  if (org.subscriptionStatus === "past_due") {
    return { ...base, state: "past_due", canWrite: true, plan, limits };
  }
  if (org.trialEndsAt > now) return { ...base, state: "trial", canWrite: true, plan: null, limits: TRIAL_LIMITS };
  return { ...base, state: "inactive", canWrite: false, plan, limits: plan ? PLANS[plan].limits : TRIAL_LIMITS };
}

export function daysLeft(until: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 86_400_000));
}

// AI drafts are counted per calendar month (UTC).
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function inactiveMessage(access: Access): string {
  return access.subscribedBefore
    ? "Your subscription isn't active. Choose a plan on the Billing page to keep listing."
    : "Your free trial has ended. Choose a plan on the Billing page to keep listing.";
}

function allowance(access: Access): string {
  return access.plan ? `Your ${PLANS[access.plan].name} plan includes` : "The free trial includes";
}

function nextStep(access: Access): string {
  return access.plan ? "Upgrade on the Billing page" : "Choose a plan on the Billing page";
}

export function listingLimitMessage(access: Access): string {
  return `${allowance(access)} ${access.limits.activeListings} active listings. ${nextStep(access)} to post more, or archive items you no longer sell.`;
}

export function draftLimitMessage(access: Access): string {
  return `${allowance(access)} ${access.limits.aiDraftsPerMonth} AI drafts a month, and they're used up. ${nextStep(access)} for more, or add items by hand.`;
}
