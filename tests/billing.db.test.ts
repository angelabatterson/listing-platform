import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { aiDrafts, batches, items, organizations, photos } from "@/db/schema";

const user = { id: "", organizationId: "", email: "seller@example.com", name: null };
vi.mock("@/lib/auth", () => ({ requireUser: async () => user, getCurrentUser: async () => user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/sync/run", () => ({ syncItem: async () => [] }));
const askForJson = vi.fn();
vi.mock("@/lib/ai/client", async (original) => ({
  ...(await original<typeof import("@/lib/ai/client")>()),
  askForJson: (...args: unknown[]) => askForJson(...args),
}));
const retrieve = vi.fn();
vi.mock("@/lib/billing/stripe", async (original) => {
  const real = await original<typeof import("@/lib/billing/stripe")>();
  return {
    ...real,
    stripe: () => ({ webhooks: new Stripe("sk_test_x").webhooks, subscriptions: { retrieve } }),
  };
});

const { draftItem, postDraft } = await import("@/app/(app)/batches/actions");
const { saveItem } = await import("@/app/(app)/items/actions");
const { POST: webhook } = await import("@/app/api/stripe/webhook/route");

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBHOOK_SECRET = "whsec_test";

function subscription(overrides: Partial<Stripe.Subscription> & { price?: string } = {}): Stripe.Subscription {
  const { price = "price_pro", ...rest } = overrides;
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    metadata: { organizationId: user.organizationId },
    cancel_at_period_end: false,
    cancel_at: null,
    items: { data: [{ price: { id: price }, current_period_end: 1_800_000_000 }] },
    ...rest,
  } as unknown as Stripe.Subscription;
}

async function sendWebhook(type: string, object: object) {
  const payload = JSON.stringify({ id: "evt_1", object: "event", type, data: { object } });
  const header = new Stripe("sk_test_x").webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return webhook(new Request("https://app.example/api/stripe/webhook", {
    method: "POST",
    body: payload,
    headers: { "stripe-signature": header },
  }));
}

const draft = {
  title: "Blue mug",
  description: "A mug.",
  condition: "USED_GOOD",
  brand: null,
  itemSpecifics: [],
  categoryQuery: "mug",
  suggestedPrice: 12,
  priceNote: "Typical.",
  whenMade: "2010_2019",
};

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("subscriptions and plan limits", () => {
  let batchId: string;

  beforeEach(async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("STRIPE_PRICE_STARTER", "price_starter");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_pro");
    vi.stubEnv("STRIPE_PRICE_BUSINESS", "price_business");
    await db.delete(organizations);
    askForJson.mockReset();
    retrieve.mockReset();
    const [org] = await db.insert(organizations).values({ name: "Test" }).returning();
    user.organizationId = org.id;
    const [batch] = await db.insert(batches).values({ organizationId: org.id, number: 1 }).returning();
    batchId = batch.id;
    await db.insert(photos).values({ organizationId: org.id, batchId, position: 0, groupKey: 0, data: jpeg, thumb: jpeg });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  const org = async () => (await db.query.organizations.findFirst({ where: eq(organizations.id, user.organizationId) }))!;

  it("starts new accounts on a 14-day trial", async () => {
    const days = ((await org()).trialEndsAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
  });

  it("stops AI drafting and posting once the trial has ended", async () => {
    await db.update(organizations).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(organizations.id, user.organizationId));
    const result = await draftItem(batchId, 0);
    expect(result.error).toMatch(/free trial has ended/);
    expect(askForJson).not.toHaveBeenCalled();

    const form = new FormData();
    for (const [k, v] of Object.entries({ title: "Mug", sku: "MUG-1", price: "5", quantity: "1", condition: "USED_GOOD", status: "active" })) {
      form.set(k, v);
    }
    expect(await saveItem(null, undefined, form)).toEqual({ error: expect.stringMatching(/free trial has ended/) });
    expect(await db.query.items.findMany()).toHaveLength(0);
  });

  it("counts AI drafts against the monthly allowance", async () => {
    askForJson.mockResolvedValue(draft);
    expect((await draftItem(batchId, 0)).itemId).toBeDefined();
    expect(await db.select().from(aiDrafts)).toHaveLength(1);

    await db.insert(aiDrafts).values(Array.from({ length: 49 }, () => ({ organizationId: user.organizationId })));
    await db.insert(photos).values({ organizationId: user.organizationId, batchId, position: 1, groupKey: 1, data: jpeg, thumb: jpeg });
    expect((await draftItem(batchId, 1)).error).toMatch(/50 AI drafts a month/);
    expect(askForJson).toHaveBeenCalledTimes(1);
  });

  it("stops posting at the plan's active listing limit", async () => {
    await db.insert(items).values(
      Array.from({ length: 100 }, (_, i) => ({
        organizationId: user.organizationId,
        sku: `A${i}`,
        title: "Old",
        priceCents: 100,
        status: "active" as const,
      })),
    );
    const [item] = await db
      .insert(items)
      .values({ organizationId: user.organizationId, sku: "NEW", title: "New", priceCents: 100, status: "draft" })
      .returning();
    expect((await postDraft(item.id)).error).toMatch(/100 active listings/);
  });

  it("updates the account from Stripe webhooks, using the latest subscription", async () => {
    retrieve.mockResolvedValue(subscription({ status: "active", price: "price_business" }));
    // The event's own copy is stale; the route fetches the current one.
    const res = await sendWebhook("customer.subscription.updated", subscription({ status: "incomplete" }));
    expect(res.status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith("sub_1");
    expect(await org()).toMatchObject({
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      subscriptionStatus: "active",
      plan: "business",
      currentPeriodEnd: new Date(1_800_000_000 * 1000),
      cancelAtPeriodEnd: false,
    });

    // Checkout completion links the subscription the same way.
    retrieve.mockResolvedValue(subscription({ status: "past_due", price: "price_pro" }));
    await sendWebhook("checkout.session.completed", { id: "cs_1", subscription: "sub_1" });
    expect(await org()).toMatchObject({ subscriptionStatus: "past_due", plan: "pro" });
  });

  it("doesn't let an old subscription ending overwrite a running one", async () => {
    retrieve.mockResolvedValue(subscription({ id: "sub_new", status: "active" }));
    await sendWebhook("customer.subscription.created", { id: "sub_new" });
    retrieve.mockResolvedValue(subscription({ id: "sub_old", status: "canceled" }));
    await sendWebhook("customer.subscription.deleted", { id: "sub_old" });
    expect(await org()).toMatchObject({ stripeSubscriptionId: "sub_new", subscriptionStatus: "active" });
  });

  it("rejects webhooks without a valid signature", async () => {
    const res = await webhook(new Request("https://app.example/api/stripe/webhook", {
      method: "POST",
      body: JSON.stringify({ type: "customer.subscription.updated" }),
      headers: { "stripe-signature": "t=1,v1=bad" },
    }));
    expect(res.status).toBe(400);
    expect(retrieve).not.toHaveBeenCalled();
  });
});
