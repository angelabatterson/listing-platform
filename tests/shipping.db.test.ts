import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { connections, organizations, sales, shippingLabels, shippingSettings } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { ordersToShip } from "@/lib/shipping/settings";

const user = { id: "u", organizationId: "", email: "seller@example.com", name: null as string | null };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireUser: async () => user,
}));
vi.mock("@/lib/billing/access", () => ({ writeProblem: async () => null }));
const { buyShippingLabel, quoteRates, saveShippoKey } = await import("@/app/(app)/shipping/actions");

const ebayOrder = {
  orderFulfillmentStatus: "NOT_STARTED",
  lineItems: [{ lineItemId: "L1", quantity: 1 }],
  fulfillmentStartInstructions: [
    {
      shippingStep: {
        shipTo: {
          fullName: "Pat Buyer",
          contactAddress: { addressLine1: "2 Oak Ave", city: "Austin", stateOrProvince: "TX", postalCode: "78701", countryCode: "US" },
        },
      },
    },
  ],
};

let calls: string[] = [];
function stubApis() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const key = `${init.method ?? "GET"} ${url.host}${url.pathname}`;
      calls.push(key);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (key.endsWith("/shipments/") && init.method === "POST") {
        return json({ rates: [{ object_id: "r1", amount: "5.25", currency: "USD", provider: "USPS", servicelevel: { name: "Ground Advantage" } }] });
      }
      if (key.endsWith("/shipments/")) return json({ results: [] });
      if (key.endsWith("/rates/r1")) return json({ object_id: "r1", amount: "5.25", currency: "USD", provider: "USPS", servicelevel: { name: "Ground Advantage" } });
      if (key.endsWith("/transactions/")) {
        return json({ object_id: "t1", status: "SUCCESS", tracking_number: "9400", label_url: "https://label/t1.pdf" });
      }
      if (key.endsWith("/sell/fulfillment/v1/order/O-1")) return json(ebayOrder);
      if (key.endsWith("/shipping_fulfillment")) return new Response(null, { status: 201 });
      return new Response("not stubbed", { status: 500 });
    }),
  );
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("buying shipping labels", () => {
  let ebayId: string;

  beforeEach(async () => {
    await db.delete(organizations);
    stubApis();
    const [org] = await db.insert(organizations).values({ name: "Mine" }).returning();
    user.organizationId = org.id;
    const [ebay] = await db
      .insert(connections)
      .values({ organizationId: org.id, marketplace: "ebay", environment: "sandbox", accessTokenEnc: encrypt("t"), accessTokenExpiresAt: new Date(Date.now() + 3600_000) })
      .returning();
    ebayId = ebay.id;
    await db.insert(sales).values([
      { organizationId: org.id, connectionId: ebay.id, externalOrderId: "O-1", externalLineId: "L1", quantity: 1, soldAt: new Date(), title: "Jacket" },
      { organizationId: org.id, connectionId: ebay.id, externalOrderId: "O-OLD", externalLineId: "L2", quantity: 1, soldAt: new Date(Date.now() - 40 * 86_400_000) },
    ]);
    await db.insert(shippingSettings).values({
      organizationId: org.id,
      apiTokenEnc: encrypt("shippo_live_k"),
      fromAddress: { name: "Seller", street1: "1 Main St", city: "Albany", state: "NY", zip: "12207", country: "US", phone: "5555550100" },
    });
  });

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await db.delete(organizations);
  });

  it("checks a Shippo key before saving it", async () => {
    expect((await saveShippoKey(undefined, form({ token: "nope" })))?.error).toMatch(/doesn't look like/);
    expect((await saveShippoKey(undefined, form({ token: "shippo_test_abc" })))?.saved).toMatch(/Test key/);
    expect(calls).toEqual(["GET api.goshippo.com/shipments/"]);
    expect((await db.query.shippingSettings.findFirst())?.testMode).toBe(true);
  });

  it("quotes, buys, records the label and sends tracking to the store", async () => {
    expect((await ordersToShip(user.organizationId)).map((o) => o.orderId)).toEqual(["O-1"]);
    const quote = await quoteRates(ebayId, "O-1", undefined, form({ lengthIn: "10", widthIn: "8", heightIn: "4", pounds: "1", ounces: "4" }));
    expect(quote?.rates?.map((r) => r.id)).toEqual(["r1"]);

    await expect(buyShippingLabel(ebayId, "O-1", "r1")).rejects.toThrow("redirect:/shipping/");
    const [label] = await db.select().from(shippingLabels);
    expect(label).toMatchObject({ externalOrderId: "O-1", carrier: "USPS", costCents: 525, trackingNumber: "9400", trackingError: null });
    expect(label.trackingSentAt).toBeInstanceOf(Date);
    expect(calls).toContain(`POST api.sandbox.ebay.com/sell/fulfillment/v1/order/O-1/shipping_fulfillment`);
    expect(await ordersToShip(user.organizationId)).toEqual([]);
  });

  it("doesn't send sample tracking from a test key to the store", async () => {
    await db.update(shippingSettings).set({ apiTokenEnc: encrypt("shippo_test_k"), testMode: true });
    await expect(buyShippingLabel(ebayId, "O-1", "r1")).rejects.toThrow("redirect:");
    const [label] = await db.select().from(shippingLabels);
    expect(label).toMatchObject({ testMode: true, trackingSentAt: null });
    expect(calls.some((c) => c.endsWith("shipping_fulfillment"))).toBe(false);
  });

  it("won't ship an order that isn't one of the account's sales", async () => {
    expect((await buyShippingLabel(ebayId, "SOMEONE-ELSES", "r1"))?.error).toMatch(/wasn't found/);
    expect(calls.some((c) => c.endsWith("/transactions/"))).toBe(false);
  });
});
