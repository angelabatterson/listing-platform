import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accessFor,
  daysLeft,
  draftLimitMessage,
  hasLiveSubscription,
  listingLimitMessage,
  monthStart,
  planForPrice,
  PLANS,
  TRIAL_LIMITS,
} from "@/lib/billing/plans";

const now = new Date("2026-11-10T12:00:00Z");
const later = new Date("2026-11-20T12:00:00Z");
const earlier = new Date("2026-11-01T12:00:00Z");
const on = { enabled: true, exempt: false };

describe("account access", () => {
  it("gives full use when billing is off or the account is exempt", () => {
    const expired = { trialEndsAt: earlier, subscriptionStatus: null, plan: null };
    for (const opts of [{ enabled: false, exempt: false }, { enabled: true, exempt: true }]) {
      const access = accessFor(expired, opts, now);
      expect(access).toMatchObject({ state: "free", canWrite: true });
      expect(access.limits).toEqual({ activeListings: null, aiDraftsPerMonth: null });
    }
  });

  it("uses trial limits during the trial and locks the account after it", () => {
    expect(accessFor({ trialEndsAt: later, subscriptionStatus: null, plan: null }, on, now)).toMatchObject({
      state: "trial",
      canWrite: true,
      limits: TRIAL_LIMITS,
    });
    const ended = accessFor({ trialEndsAt: earlier, subscriptionStatus: null, plan: null }, on, now);
    expect(ended).toMatchObject({ state: "inactive", canWrite: false, subscribedBefore: false });
  });

  it("follows the Stripe subscription status", () => {
    const sub = (subscriptionStatus: string) => accessFor({ trialEndsAt: earlier, subscriptionStatus, plan: "pro" }, on, now);
    expect(sub("active")).toMatchObject({ state: "active", canWrite: true, plan: "pro", limits: PLANS.pro.limits });
    expect(sub("trialing")).toMatchObject({ state: "active", canWrite: true });
    expect(sub("past_due")).toMatchObject({ state: "past_due", canWrite: true });
    for (const status of ["canceled", "unpaid", "incomplete_expired", "paused"]) {
      expect(sub(status)).toMatchObject({ state: "inactive", canWrite: false, subscribedBefore: true });
    }
  });

  it("still allows the rest of the trial when a first checkout is left unfinished", () => {
    const access = accessFor({ trialEndsAt: later, subscriptionStatus: "incomplete", plan: "pro" }, on, now);
    expect(access).toMatchObject({ state: "trial", canWrite: true });
  });

  it("never locks out a paying account whose price isn't mapped to a plan", () => {
    const access = accessFor({ trialEndsAt: earlier, subscriptionStatus: "active", plan: null }, on, now);
    expect(access).toMatchObject({ state: "active", canWrite: true, plan: null });
    expect(access.limits.activeListings).toBeNull();
  });

  it("counts live subscriptions, including ones Stripe is retrying", () => {
    expect(["active", "trialing", "past_due"].every(hasLiveSubscription)).toBe(true);
    expect([null, "canceled", "incomplete", "unpaid"].some(hasLiveSubscription)).toBe(false);
  });
});

describe("plans and prices", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps Stripe prices to plans from the environment", () => {
    vi.stubEnv("STRIPE_PRICE_STARTER", "price_s");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_p");
    vi.stubEnv("STRIPE_PRICE_BUSINESS", "");
    expect(planForPrice("price_p")).toBe("pro");
    expect(planForPrice("price_s")).toBe("starter");
    expect(planForPrice("price_other")).toBeNull();
    expect(planForPrice("")).toBeNull();
    expect(planForPrice(undefined)).toBeNull();
  });

  it("explains limits in the seller's terms", () => {
    const trial = accessFor({ trialEndsAt: later, subscriptionStatus: null, plan: null }, on, now);
    expect(listingLimitMessage(trial)).toMatch(/^The free trial includes 100 active listings\. Choose a plan/);
    const starter = accessFor({ trialEndsAt: earlier, subscriptionStatus: "active", plan: "starter" }, on, now);
    expect(draftLimitMessage(starter)).toMatch(/^Your Starter plan includes 50 AI drafts a month.*Upgrade/);
  });

  it("counts days and months", () => {
    expect(daysLeft(later, now)).toBe(10);
    expect(daysLeft(earlier, now)).toBe(0);
    expect(monthStart(now).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});
