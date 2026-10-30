import { afterEach, describe, expect, it, vi } from "vitest";
import { createStarterPolicies, ebayAdapter } from "@/lib/marketplaces/ebay/adapter";
import { bestOfferPrices, toInventoryItem, toOffer, validateForEbay } from "@/lib/marketplaces/ebay/mapping";
import { watcherOfferBody } from "@/lib/marketplaces/ebay/negotiation";
import { buildAuthorizeUrl } from "@/lib/marketplaces/ebay/oauth";
import { fetchEbaySales, orderToSales } from "@/lib/marketplaces/ebay/orders";
import { apportion } from "@/lib/marketplaces/orders";
import { makeConnection, makeItem, makeListing } from "./fixtures";

describe("eBay mapping", () => {
  it("builds the inventory item with ordered photos, brand and aspects", () => {
    const body = toInventoryItem(makeItem({ title: "x".repeat(100) }), makeListing());
    expect(body.product.title).toHaveLength(80);
    expect(body.product.imageUrls).toEqual(["https://img.example/1.jpg", "https://img.example/2.jpg"]);
    expect(body.product.aspects).toEqual({ Size: ["M"], Brand: ["Levi's"] });
    expect(body.availability.shipToLocationAvailability.quantity).toBe(1);
  });

  it("uses the per-store price override in the offer", () => {
    const offer = toOffer(makeItem(), makeListing({ overrides: { categoryId: "1", priceCents: 5000 } }), makeConnection().settings);
    expect(offer.pricingSummary.price).toEqual({ value: "50.00", currency: "USD" });
    expect(offer.categoryId).toBe("1");
    expect(offer.listingPolicies.fulfillmentPolicyId).toBe("f1");
  });

  it("explains what's missing before calling eBay", () => {
    const problems = validateForEbay(makeItem({ images: [] }), makeListing({ overrides: {} }), {});
    expect(problems).toEqual([
      "Choose an eBay category for this item.",
      "Add at least one photo.",
      "Set your ship-from location on the Stores page.",
      "Pick your eBay shipping, payment and return policies on the Stores page.",
    ]);
  });
});

describe("eBay automations", () => {
  const settings = (bestOffer?: { enabled: boolean; acceptPct: number; declinePct: number }) => ({
    ...makeConnection().settings,
    automations: { bestOffer },
  });
  const listing = makeListing({ overrides: { categoryId: "1", priceCents: 5000 } });

  it("leaves Best Offer alone until the seller sets it", () => {
    expect(toOffer(makeItem(), listing, settings()).listingPolicies.bestOfferTerms).toBeUndefined();
  });

  it("sets auto-accept and auto-decline prices from the listing price", () => {
    const terms = toOffer(makeItem(), listing, settings({ enabled: true, acceptPct: 90, declinePct: 70 })).listingPolicies.bestOfferTerms;
    expect(terms).toEqual({
      bestOfferEnabled: true,
      autoAcceptPrice: { value: "45.00", currency: "USD" },
      autoDeclinePrice: { value: "35.00", currency: "USD" },
    });
  });

  it("turns Best Offer off when the seller switches it off", () => {
    const terms = toOffer(makeItem(), listing, settings({ enabled: false, acceptPct: 90, declinePct: 70 })).listingPolicies.bestOfferTerms;
    expect(terms).toEqual({ bestOfferEnabled: false });
  });

  it("skips prices set to 0 and a decline price that isn't below the accept price", () => {
    expect(bestOfferPrices(5000, { enabled: true, acceptPct: 0, declinePct: 60 })).toEqual({ acceptCents: undefined, declineCents: 3000 });
    expect(bestOfferPrices(5000, { enabled: true, acceptPct: 80, declinePct: 80 })).toEqual({ acceptCents: 4000, declineCents: undefined });
  });

  it("builds a watcher offer with a percent discount and no counter-offers", () => {
    expect(watcherOfferBody("L1", 10, "Thanks!")).toEqual({
      allowCounterOffer: false,
      message: "Thanks!",
      offerDuration: { unit: "DAY", value: 2 },
      offeredItems: [{ listingId: "L1", quantity: 1, discountPercentage: "10" }],
    });
    expect(watcherOfferBody("L1", 10)).not.toHaveProperty("message");
  });
});

describe("eBay OAuth", () => {
  it("sends sellers to the sandbox consent page with the RuName and state", () => {
    const url = new URL(buildAuthorizeUrl("state123"));
    expect(url.origin).toBe("https://auth.sandbox.ebay.com");
    expect(url.searchParams.get("redirect_uri")).toBe("ru-name");
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("scope")).toContain("sell.inventory");
  });
});

describe("eBay adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(responses: Record<string, { status: number; body?: unknown }>) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        const key = `${init.method} ${url.pathname}${url.search}`;
        calls.push(key);
        const match = responses[key];
        if (!match) throw new Error(`Unexpected request: ${key}`);
        return new Response(match.body === undefined ? null : JSON.stringify(match.body), { status: match.status });
      }),
    );
    return calls;
  }

  it("creates starter policies, reusing one Relistic made before", async () => {
    const bodies: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        const key = `${init.method} ${url.pathname}`;
        if (init.body) bodies[key] = JSON.parse(String(init.body));
        const list = (kind: string, items: object[]) => Response.json({ [`${kind}Policies`]: items });
        if (key === "GET /sell/account/v1/fulfillment_policy") return list("fulfillment", []);
        if (key === "GET /sell/account/v1/payment_policy") return list("payment", [{ paymentPolicyId: "P9", name: "Relistic payment" }]);
        if (key === "GET /sell/account/v1/return_policy") return list("return", []);
        if (key === "POST /sell/account/v1/fulfillment_policy") {
          // Like eBay's sandbox, which doesn't know Ground Advantage.
          const body = JSON.parse(String(init.body));
          if (body.shippingOptions[0].shippingServices[0].shippingServiceCode === "USPSGroundAdvantage") {
            return Response.json({ errors: [{ errorId: 20403, message: "Please select a valid shipping service." }] }, { status: 400 });
          }
          return Response.json({ fulfillmentPolicyId: "F1" }, { status: 201 });
        }
        if (key === "PUT /sell/account/v1/payment_policy/P9") return Response.json({ paymentPolicyId: "P9" });
        if (key === "POST /sell/account/v1/return_policy") return Response.json({ returnPolicyId: "R1" }, { status: 201 });
        throw new Error(`Unexpected request: ${key}`);
      }),
    );
    const ids = await createStarterPolicies(makeConnection(), { shippingCents: 0, handlingDays: 1, returnDays: 0 });
    expect(ids).toEqual({ fulfillmentPolicyId: "F1", paymentPolicyId: "P9", returnPolicyId: "R1" });
    expect(bodies["POST /sell/account/v1/fulfillment_policy"]).toMatchObject({
      name: "Relistic shipping",
      marketplaceId: "EBAY_US",
      handlingTime: { value: 1, unit: "DAY" },
      shippingOptions: [{ shippingServices: [{ shippingServiceCode: "USPSPriority", freeShipping: true }] }],
    });
    expect(bodies["POST /sell/account/v1/return_policy"]).toMatchObject({ returnsAccepted: false });
  });

  it("creates the inventory item, creates an offer, then publishes it", async () => {
    const calls = stubFetch({
      "PUT /sell/inventory/v1/inventory_item/JACKET-001": { status: 204 },
      "POST /sell/inventory/v1/offer": { status: 201, body: { offerId: "O1" } },
      "POST /sell/inventory/v1/offer/O1/publish": { status: 200, body: { listingId: "L1" } },
    });
    const result = await ebayAdapter.upsertListing(makeItem(), makeListing(), makeConnection());
    expect(result).toEqual({ remoteListingId: "L1", remoteOfferId: "O1" });
    expect(calls).toHaveLength(3);
  });

  it("updates a live listing without republishing", async () => {
    const calls = stubFetch({
      "PUT /sell/inventory/v1/inventory_item/JACKET-001": { status: 204 },
      "PUT /sell/inventory/v1/offer/O1": { status: 204 },
    });
    const listing = makeListing({ status: "listed", remoteOfferId: "O1", remoteListingId: "L1" });
    const result = await ebayAdapter.upsertListing(makeItem(), listing, makeConnection());
    expect(result).toEqual({ remoteListingId: "L1", remoteOfferId: "O1" });
    expect(calls).toHaveLength(2);
  });

  it("reuses an existing offer when eBay says one already exists", async () => {
    stubFetch({
      "PUT /sell/inventory/v1/inventory_item/JACKET-001": { status: 204 },
      "POST /sell/inventory/v1/offer": { status: 400, body: { errors: [{ errorId: 25002, message: "exists" }] } },
      "GET /sell/inventory/v1/offer?sku=JACKET-001&marketplace_id=EBAY_US": { status: 200, body: { offers: [{ offerId: "O9" }] } },
      "PUT /sell/inventory/v1/offer/O9": { status: 204 },
      "POST /sell/inventory/v1/offer/O9/publish": { status: 200, body: { listingId: "L9" } },
    });
    const result = await ebayAdapter.upsertListing(makeItem(), makeListing(), makeConnection());
    expect(result).toEqual({ remoteListingId: "L9", remoteOfferId: "O9" });
  });

  it("sets Best Offer on a listing made on eBay's website through the Trading API", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init: RequestInit) => {
        bodies.push(String(init.body));
        const call = (init.headers as Record<string, string>)["X-EBAY-API-CALL-NAME"];
        return new Response(`<${call}Response><Ack>Success</Ack></${call}Response>`, { status: 200 });
      }),
    );
    const listing = makeListing({ status: "listed", remoteListingId: "W1", remoteOfferId: null, overrides: { priceCents: 5000 } });
    const connection = makeConnection();
    connection.settings.automations = { bestOffer: { enabled: true, acceptPct: 90, declinePct: 70 } };
    await ebayAdapter.upsertListing(makeItem(), listing, connection);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain("<BestOfferEnabled>true</BestOfferEnabled>");
    expect(bodies[1]).toContain("<BestOfferAutoAcceptPrice>45.00</BestOfferAutoAcceptPrice>");
    expect(bodies[1]).toContain("<MinimumBestOfferPrice>35.00</MinimumBestOfferPrice>");
  });

  it("withdraws the offer to end a listing", async () => {
    const calls = stubFetch({ "POST /sell/inventory/v1/offer/O1/withdraw": { status: 200, body: { listingId: "L1" } } });
    await ebayAdapter.endListing(makeListing({ remoteOfferId: "O1" }), makeConnection());
    expect(calls).toEqual(["POST /sell/inventory/v1/offer/O1/withdraw"]);
  });

  it("surfaces eBay's error message", async () => {
    stubFetch({
      "PUT /sell/inventory/v1/inventory_item/JACKET-001": {
        status: 400,
        body: { errors: [{ errorId: 25709, longMessage: "Invalid value for condition." }] },
      },
    });
    await expect(ebayAdapter.upsertListing(makeItem(), makeListing(), makeConnection())).rejects.toThrow(
      "Invalid value for condition.",
    );
  });
});

describe("eBay orders", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pages through orders and skips canceled ones", async () => {
    const order = (id: string, cancelState = "NONE_REQUESTED") => ({
      orderId: id,
      creationDate: "2026-10-28T10:00:00.000Z",
      cancelStatus: { cancelState },
      lineItems: [{ lineItemId: `${id}-L`, sku: "JACKET-001", legacyItemId: "E1", quantity: 1 }],
    });
    const offsets: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL) => {
        const offset = input.searchParams.get("offset")!;
        offsets.push(offset);
        expect(input.searchParams.get("filter")).toBe("creationdate:[2026-10-28T09:00:00.000Z..]");
        const body =
          offset === "0"
            ? { total: 201, orders: [order("A"), order("B", "CANCELED")] }
            : { total: 201, orders: [order("C")] };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const lines = await fetchEbaySales(makeConnection(), new Date("2026-10-28T09:00:00.000Z"));
    expect(offsets).toEqual(["0", "200"]);
    expect(lines.map((l) => [l.orderId, l.lineId, l.remoteListingId])).toEqual([
      ["A", "A-L", "E1"],
      ["C", "C-L", "E1"],
    ]);
  });
});

describe("eBay order money", () => {
  it("records price after discounts, shipping, a share of the order's fees, and the buyer", () => {
    const lines = orderToSales({
      orderId: "O9",
      creationDate: "2026-10-28T10:00:00.000Z",
      buyer: { username: "pyrexfan", buyerRegistrationAddress: { fullName: "Pat Buyer" } },
      totalMarketplaceFee: { value: "10.01", currency: "USD" },
      lineItems: [
        {
          lineItemId: "L1",
          quantity: 1,
          title: "Jacket",
          lineItemCost: { value: "60.00", currency: "USD" },
          deliveryCost: { shippingCost: { value: "8.50" } },
          appliedPromotions: [{ discountAmount: { value: "5.00" } }],
        },
        { lineItemId: "L2", quantity: 2, title: "Mugs", lineItemCost: { value: "27.50", currency: "USD" } },
      ],
    });
    expect(lines).toMatchObject([
      { lineId: "L1", priceCents: 5500, shippingCents: 850, feesCents: 668, currency: "USD", buyerId: "pyrexfan", buyerName: "Pat Buyer" },
      { lineId: "L2", priceCents: 2750, shippingCents: null, feesCents: 333, title: "Mugs" },
    ]);
    expect(lines[0].feesCents! + lines[1].feesCents!).toBe(1001);
  });

  it("splits an amount by weight without losing cents", () => {
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportion(500, [0, 0])).toEqual([500, 0]);
  });
});
