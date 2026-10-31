import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { etsyAdapter } from "@/lib/marketplaces/etsy/adapter";
import { toDraftListing, toInventory, validateForEtsy } from "@/lib/marketplaces/etsy/mapping";
import { buildAuthorizeUrl, createPkce } from "@/lib/marketplaces/etsy/oauth";
import { receiptToSales } from "@/lib/marketplaces/etsy/orders";
import { checkEtsyPrices, summarizeEtsyListings } from "@/lib/marketplaces/etsy/prices";
import { verifyEtsyWebhook } from "@/lib/marketplaces/etsy/webhook";
import { makeConnection, makeItem, makeListing } from "./fixtures";

const etsySettings = {
  shopId: "555",
  shippingProfileId: "11",
  returnPolicyId: "22",
  readinessStateId: "33",
  whoMade: "someone_else" as const,
};
const etsyConnection = () => makeConnection({ id: "conn-etsy", marketplace: "etsy", settings: etsySettings });
const etsyListing = (overrides = {}) =>
  makeListing({ connectionId: "conn-etsy", overrides: { categoryId: "1429", whenMade: "1990s" }, ...overrides });

describe("Etsy mapping", () => {
  it("builds a draft listing in dollars with the shop's profiles", () => {
    const draft = toDraftListing(makeItem(), etsyListing(), etsySettings);
    expect(draft).toMatchObject({
      title: "Vintage denim jacket",
      price: 45.5,
      quantity: 1,
      who_made: "someone_else",
      when_made: "1990s",
      taxonomy_id: "1429",
      shipping_profile_id: "11",
      return_policy_id: "22",
      readiness_state_id: "33",
      type: "physical",
    });
  });

  it("sends a single product with the SKU, price and quantity", () => {
    const body = toInventory(makeItem({ quantity: 3 }), etsyListing({ overrides: { priceCents: 5000 } }), etsySettings);
    expect(body.products).toEqual([
      {
        sku: "JACKET-001",
        property_values: [],
        offerings: [{ price: 50, quantity: 3, is_enabled: true, readiness_state_id: 33 }],
      },
    ]);
  });

  it("explains what's missing before calling Etsy", () => {
    expect(validateForEtsy(makeItem({ images: [] }), makeListing({ overrides: {} }), {})).toEqual([
      "Choose an Etsy category for this item.",
      "Choose when the item was made for Etsy.",
      "Add at least one photo.",
      "Reconnect your Etsy shop.",
      "Pick your Etsy shipping profile, return policy and processing profile on the Stores page.",
    ]);
  });

  it("refuses photo links that point at private addresses", () => {
    const item = makeItem({ images: [{ id: "i", itemId: "item-1", url: "https://169.254.169.254/x.jpg", position: 0 }] });
    expect(validateForEtsy(item, etsyListing(), etsySettings)).toContain("Photo links must be public https:// links.");
  });
});

describe("Etsy OAuth", () => {
  it("uses PKCE with an S256 challenge", () => {
    const { verifier, challenge } = createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const url = new URL(buildAuthorizeUrl("st", challenge));
    expect(url.origin + url.pathname).toBe("https://www.etsy.com/oauth/connect");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/api/etsy/oauth/callback");
    expect(url.searchParams.get("scope")).toContain("transactions_r");
  });
});

describe("Etsy adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(responses: Record<string, { status: number; body?: unknown; raw?: BodyInit }>) {
    const calls: { key: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string, init: RequestInit = {}) => {
        const url = new URL(String(input));
        const key = `${init.method ?? "GET"} ${url.host}${url.pathname}`;
        calls.push({ key, init });
        const match = responses[key];
        if (!match) throw new Error(`Unexpected request: ${key}`);
        return new Response(match.raw ?? (match.body === undefined ? null : JSON.stringify(match.body)), {
          status: match.status,
        });
      }),
    );
    return calls;
  }

  it("creates a draft, uploads photos in order, sets inventory, then activates", async () => {
    const calls = stubFetch({
      "POST api.etsy.com/v3/application/shops/555/listings": { status: 201, body: { listing_id: 9001 } },
      "GET img.example/1.jpg": { status: 200, raw: new Blob(["one"]) },
      "GET img.example/2.jpg": { status: 200, raw: new Blob(["two"]) },
      "POST api.etsy.com/v3/application/shops/555/listings/9001/images": { status: 201, body: {} },
      "PUT api.etsy.com/v3/application/listings/9001/inventory": { status: 200, body: {} },
      "PATCH api.etsy.com/v3/application/shops/555/listings/9001": { status: 200, body: {} },
    });
    const created: string[] = [];
    const result = await etsyAdapter.upsertListing(makeItem(), etsyListing(), etsyConnection(), {
      onCreated: async (id) => void created.push(id),
    });

    expect(result).toEqual({ remoteListingId: "9001" });
    expect(created).toEqual(["9001"]);
    expect(calls.map((c) => c.key)).toEqual([
      "POST api.etsy.com/v3/application/shops/555/listings",
      "GET img.example/1.jpg",
      "POST api.etsy.com/v3/application/shops/555/listings/9001/images",
      "GET img.example/2.jpg",
      "POST api.etsy.com/v3/application/shops/555/listings/9001/images",
      "PUT api.etsy.com/v3/application/listings/9001/inventory",
      "PATCH api.etsy.com/v3/application/shops/555/listings/9001",
    ]);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("etsykey:etsysecret");
    expect(String(calls.at(-1)!.init.body)).toBe("state=active");
  });

  it("updates a live listing without re-uploading photos or re-activating", async () => {
    const calls = stubFetch({
      "PATCH api.etsy.com/v3/application/shops/555/listings/9001": { status: 200, body: {} },
      "PUT api.etsy.com/v3/application/listings/9001/inventory": { status: 200, body: {} },
    });
    const listing = etsyListing({ status: "listed", remoteListingId: "9001" });
    await etsyAdapter.upsertListing(makeItem(), listing, etsyConnection());
    expect(calls.map((c) => c.key)).toEqual([
      "PATCH api.etsy.com/v3/application/shops/555/listings/9001",
      "PUT api.etsy.com/v3/application/listings/9001/inventory",
    ]);
  });

  it("deactivates the listing to end it", async () => {
    const calls = stubFetch({ "PATCH api.etsy.com/v3/application/shops/555/listings/9001": { status: 200, body: {} } });
    await etsyAdapter.endListing(etsyListing({ remoteListingId: "9001" }), etsyConnection());
    expect(String(calls[0].init.body)).toBe("state=inactive");
  });
});

describe("Etsy webhooks", () => {
  const secretBytes = Buffer.from("super-secret-signing-key");
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const body = JSON.stringify({ event_type: "order.paid", shop_id: "555" });
  const now = 1_800_000_000_000;
  const sign = (id: string, ts: string, raw: string) =>
    createHmac("sha256", secretBytes).update(`${id}.${ts}.${raw}`).digest("base64");

  it("accepts a correctly signed, recent event", () => {
    const ts = String(now / 1000);
    const headers = { id: "msg_1", timestamp: ts, signature: `v1,${sign("msg_1", ts, body)}` };
    expect(verifyEtsyWebhook(headers, body, secret, now)).toBe(true);
  });

  it("rejects a tampered body, a wrong secret, or an old timestamp", () => {
    const ts = String(now / 1000);
    const signature = `v1,${sign("msg_1", ts, body)}`;
    expect(verifyEtsyWebhook({ id: "msg_1", timestamp: ts, signature }, body + " ", secret, now)).toBe(false);
    expect(verifyEtsyWebhook({ id: "msg_1", timestamp: ts, signature }, body, "whsec_b3RoZXI=", now)).toBe(false);
    expect(verifyEtsyWebhook({ id: "msg_1", timestamp: ts, signature }, body, secret, now + 10 * 60 * 1000)).toBe(false);
  });
});

describe("Etsy receipts", () => {
  it("turns each transaction into a sold line and skips canceled orders", () => {
    const receipt = {
      receipt_id: 77,
      created_timestamp: 1_800_000_000,
      status: "paid",
      transactions: [{ transaction_id: 1, sku: "JACKET-001", listing_id: 9001, quantity: 2 }],
    };
    expect(receiptToSales(receipt)).toMatchObject([
      {
        orderId: "77",
        lineId: "1",
        sku: "JACKET-001",
        remoteListingId: "9001",
        quantity: 2,
        soldAt: new Date(1_800_000_000_000),
        priceCents: null,
        feesCents: null,
        feesEstimated: false,
      },
    ]);
    expect(receiptToSales({ ...receipt, status: "canceled" })).toEqual([]);
  });

  it("records the price, shipping, buyer and estimated fees", () => {
    const [line] = receiptToSales({
      receipt_id: 78,
      created_timestamp: 1_800_000_000,
      status: "paid",
      name: "Sam Shopper",
      buyer_user_id: 4242,
      transactions: [
        {
          transaction_id: 2,
          quantity: 2,
          title: "Mug",
          price: { amount: 1250, divisor: 100, currency_code: "USD" },
          shipping_cost: { amount: 500, divisor: 100, currency_code: "USD" },
        },
      ],
    });
    // 9.5% of $30.00 is 285, plus the 20 cent listing and 25 cent order fees.
    expect(line).toMatchObject({
      title: "Mug",
      priceCents: 2500,
      shippingCents: 500,
      feesCents: 330,
      feesEstimated: true,
      currency: "USD",
      buyerId: "4242",
      buyerName: "Sam Shopper",
    });
  });
});

describe("Etsy price check", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("searches active listings and summarizes their USD asking prices", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        urls.push(String(url));
        return Response.json({
          count: 4,
          results: [
            { title: "Denim jacket A", url: "https://etsy.com/listing/1", price: { amount: 2000, divisor: 100, currency_code: "USD" } },
            { title: "Denim jacket B", url: "https://etsy.com/listing/2", price: { amount: 4000, divisor: 100, currency_code: "USD" } },
            { title: "Denim jacket C", url: "https://etsy.com/listing/3", price: { amount: 6000, divisor: 100, currency_code: "USD" } },
            { title: "Euro jacket", url: "https://etsy.com/listing/4", price: { amount: 9900, divisor: 100, currency_code: "EUR" } },
          ],
        });
      }),
    );
    const check = await checkEtsyPrices(makeConnection({ marketplace: "etsy" }), { query: "denim jacket", taxonomyId: "1234" });
    expect(urls[0]).toContain("/v3/application/listings/active?keywords=denim+jacket&limit=50&taxonomy_id=1234");
    expect(check).toMatchObject({ count: 3, lowCents: 3000, medianCents: 4000, highCents: 5000 });
    expect(check?.examples.map((e) => e.url)).not.toContain("https://etsy.com/listing/4");
  });

  it("says nothing was found when no listing has a USD price", () => {
    expect(summarizeEtsyListings({ results: [] })).toBeNull();
  });
});
