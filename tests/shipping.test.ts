import { afterEach, describe, expect, it, vi } from "vitest";
import { ebayOrderToShip, etsyReceiptToShip, sendTracking } from "@/lib/shipping/orders";
import { buyLabel, getRates, isTestToken, looksLikeShippoToken, ShippoError } from "@/lib/shipping/shippo";
import { makeConnection } from "./fixtures";

const from = { name: "Seller", street1: "1 Main St", city: "Albany", state: "NY", zip: "12207", country: "US", phone: "5555550100" };
const to = { name: "Pat Buyer", street1: "2 Oak Ave", city: "Austin", state: "TX", zip: "78701", country: "US" };
const parcel = { lengthIn: 10, widthIn: 8, heightIn: 4, weightOz: 20 };

type Call = { method: string; url: URL; headers: Record<string, string>; body: unknown };

function stub(responses: Record<string, { status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      calls.push({ method, url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const r = responses[`${method} ${url.pathname}`];
      if (!r) return new Response("not stubbed", { status: 500 });
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Shippo", () => {
  it("recognises keys", () => {
    expect(looksLikeShippoToken("shippo_live_abc123")).toBe(true);
    expect(looksLikeShippoToken("shippo_test_abc123")).toBe(true);
    expect(looksLikeShippoToken("sk_live_abc")).toBe(false);
    expect(isTestToken("shippo_test_abc123")).toBe(true);
  });

  it("asks for rates with the parcel in inches and ounces, cheapest first", async () => {
    const calls = stub({
      "POST /shipments/": {
        body: {
          status: "SUCCESS",
          rates: [
            { object_id: "r2", amount: "9.80", currency: "USD", provider: "UPS", servicelevel: { name: "Ground" }, estimated_days: 4 },
            { object_id: "r1", amount: "5.25", currency: "USD", provider: "USPS", servicelevel: { name: "Ground Advantage" }, estimated_days: 3 },
          ],
        },
      },
    });
    const rates = await getRates("shippo_test_k", from, to, parcel);
    expect(rates.map((r) => [r.id, r.carrier, r.service, r.costCents, r.days])).toEqual([
      ["r1", "USPS", "Ground Advantage", 525, 3],
      ["r2", "UPS", "Ground", 980, 4],
    ]);
    expect(calls[0].headers.Authorization).toBe("ShippoToken shippo_test_k");
    expect(calls[0].body).toMatchObject({
      address_from: { name: "Seller", zip: "12207" },
      address_to: { name: "Pat Buyer", city: "Austin" },
      parcels: [{ length: "10", width: "8", height: "4", distance_unit: "in", weight: "20", mass_unit: "oz" }],
      async: false,
    });
  });

  it("explains when there are no rates or the key is wrong", async () => {
    stub({ "POST /shipments/": { body: { rates: [], messages: [{ text: "Address not found." }] } } });
    await expect(getRates("shippo_live_k", from, to, parcel)).rejects.toThrow("Address not found.");
    stub({ "POST /shipments/": { status: 401, body: { detail: "Token does not exist" } } });
    await expect(getRates("shippo_live_k", from, to, parcel)).rejects.toBeInstanceOf(ShippoError);
  });

  it("buys a label and reports its cost and tracking", async () => {
    const calls = stub({
      "GET /rates/r1": { body: { object_id: "r1", amount: "5.25", currency: "USD", provider: "USPS", servicelevel: { name: "Ground Advantage" } } },
      "POST /transactions/": {
        body: { object_id: "t1", status: "SUCCESS", tracking_number: "9400", tracking_url_provider: "https://track/9400", label_url: "https://label/t1.pdf" },
      },
    });
    const label = await buyLabel("shippo_live_k", "r1");
    expect(label).toMatchObject({ id: "t1", trackingNumber: "9400", labelUrl: "https://label/t1.pdf", rate: { carrier: "USPS", costCents: 525 } });
    expect(calls[1].body).toEqual({ rate: "r1", label_file_type: "PDF_4x6", async: false });
  });

  it("fails clearly when the purchase doesn't go through", async () => {
    stub({
      "GET /rates/r1": { body: { object_id: "r1", amount: "5.25", currency: "USD", provider: "USPS" } },
      "POST /transactions/": { body: { object_id: "t1", status: "ERROR", messages: [{ text: "Insufficient funds." }] } },
    });
    await expect(buyLabel("shippo_live_k", "r1")).rejects.toThrow("Insufficient funds.");
  });
});

describe("orders to ship", () => {
  it("reads the eBay ship-to address and line items", () => {
    const order = ebayOrderToShip({
      orderFulfillmentStatus: "NOT_STARTED",
      lineItems: [{ lineItemId: "L1", quantity: 1 }],
      fulfillmentStartInstructions: [
        {
          shippingStep: {
            shipTo: {
              fullName: "Pat Buyer",
              contactAddress: { addressLine1: "2 Oak Ave", city: "Austin", stateOrProvince: "TX", postalCode: "78701", countryCode: "US" },
              primaryPhone: { phoneNumber: "5125550100" },
            },
          },
        },
      ],
    });
    expect(order).toEqual({
      shipTo: { name: "Pat Buyer", company: undefined, street1: "2 Oak Ave", street2: undefined, city: "Austin", state: "TX", zip: "78701", country: "US", phone: "5125550100", email: undefined },
      shipped: false,
      lines: [{ lineItemId: "L1", quantity: 1 }],
    });
    expect(ebayOrderToShip({ orderFulfillmentStatus: "FULFILLED" })).toMatchObject({ shipTo: null, shipped: true });
  });

  it("reads the Etsy receipt address", () => {
    expect(
      etsyReceiptToShip({
        receipt_id: 7,
        name: "Sam Lee",
        first_line: "3 Pine Rd",
        second_line: "Apt 2",
        city: "Portland",
        state: "OR",
        zip: "97201",
        country_iso: "US",
        is_shipped: false,
        transactions: [{ transaction_id: 11, quantity: 2 }],
      }),
    ).toMatchObject({
      shipTo: { name: "Sam Lee", street1: "3 Pine Rd", street2: "Apt 2", city: "Portland", state: "OR", zip: "97201", country: "US" },
      shipped: false,
      lines: [{ lineItemId: "11", quantity: 2 }],
    });
  });

  it("sends tracking to eBay and Etsy in their own formats", async () => {
    const calls = stub({
      "POST /sell/fulfillment/v1/order/O-1/shipping_fulfillment": { status: 201 },
      "POST /v3/application/shops/555/receipts/77/tracking": { body: { receipt_id: 77 } },
    });
    const order = { shipTo: null, shipped: false, lines: [{ lineItemId: "L1", quantity: 1 }] };
    await sendTracking(makeConnection({ marketplace: "ebay" }), "O-1", order, "USPS", "9400");
    await sendTracking(makeConnection({ marketplace: "etsy", settings: { shopId: "555" } }), "77", order, "USPS", "9400");
    expect(calls[0].body).toMatchObject({ lineItems: [{ lineItemId: "L1", quantity: 1 }], shippingCarrierCode: "USPS", trackingNumber: "9400" });
    expect(calls[1].body).toEqual({ tracking_code: "9400", carrier_name: "usps" });
  });
});
