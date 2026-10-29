import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EBAY_CONDITIONS } from "@/lib/marketplaces/ebay/mapping";
import { shopifyAdapter } from "@/lib/marketplaces/shopify/adapter";
import { normalizeShopDomain } from "@/lib/marketplaces/shopify/config";
import { toDescriptionHtml, toProductSet, validateForShopify } from "@/lib/marketplaces/shopify/mapping";
import { verifyShopifyQuery, verifyShopifyWebhook } from "@/lib/marketplaces/shopify/oauth";
import { orderToSales, type ShopifyOrder } from "@/lib/marketplaces/shopify/orders";
import { makeConnection, makeItem, makeListing } from "./fixtures";

const settings = { shopDomain: "mystore.myshopify.com", locationId: "gid://shopify/Location/9" };
const shopifyConnection = () =>
  makeConnection({ id: "conn-shopify", marketplace: "shopify", settings, accessTokenExpiresAt: null, refreshTokenEnc: null });

describe("Shopify store address", () => {
  it("accepts the store's myshopify address however it's typed", () => {
    for (const input of ["mystore", "MyStore.myshopify.com", "https://mystore.myshopify.com/admin", " mystore.myshopify.com/ "]) {
      expect(normalizeShopDomain(input)).toBe("mystore.myshopify.com");
    }
  });

  it("refuses other hosts", () => {
    for (const input of ["", "mystore.com", "evil.com/mystore.myshopify.com", "my_store.myshopify.com", "a.b.myshopify.com"]) {
      expect(normalizeShopDomain(input)).toBeNull();
    }
  });
});

describe("Shopify signatures", () => {
  const secret = "shh";

  it("checks the hmac on Shopify's redirect", () => {
    const params = new URLSearchParams({ code: "abc", shop: "mystore.myshopify.com", state: "xyz", timestamp: "1700000000" });
    const hmac = createHmac("sha256", secret).update(`code=abc&shop=mystore.myshopify.com&state=xyz&timestamp=1700000000`).digest("hex");
    params.set("hmac", hmac);
    expect(verifyShopifyQuery(params, secret)).toBe(true);
    params.set("shop", "other.myshopify.com");
    expect(verifyShopifyQuery(params, secret)).toBe(false);
  });

  it("checks webhook bodies", () => {
    const body = JSON.stringify({ shop_domain: "mystore.myshopify.com" });
    const hmac = createHmac("sha256", secret).update(body).digest("base64");
    expect(verifyShopifyWebhook(body, hmac, secret)).toBe(true);
    expect(verifyShopifyWebhook(`${body} `, hmac, secret)).toBe(false);
    expect(verifyShopifyWebhook(body, null, secret)).toBe(false);
  });
});

describe("Shopify mapping", () => {
  it("builds one product with price, SKU, stock and photos in order", () => {
    const input = toProductSet(makeItem({ quantity: 2 }), makeListing(), settings, { withPhotos: true });
    expect(input).toMatchObject({ title: "Vintage denim jacket", vendor: "Levi's", status: "ACTIVE" });
    expect(input.variants[0]).toEqual({
      optionValues: [{ optionName: "Title", name: "Default Title" }],
      price: "45.50",
      inventoryItem: { sku: "JACKET-001", tracked: true },
      inventoryQuantities: [{ locationId: settings.locationId, name: "available", quantity: 2 }],
    });
    expect(input.files?.map((f) => f.originalSource)).toEqual(["https://img.example/1.jpg", "https://img.example/2.jpg"]);
  });

  it("keeps the variant and leaves photos alone on updates", () => {
    const input = toProductSet(makeItem(), makeListing({ overrides: { priceCents: 3000 } }), settings, {
      variantId: "gid://shopify/ProductVariant/7",
      withPhotos: false,
    });
    expect(input.variants[0]).toMatchObject({ id: "gid://shopify/ProductVariant/7", price: "30.00" });
    expect(input.files).toBeUndefined();
  });

  it("turns the description into safe HTML with the condition", () => {
    const condition = EBAY_CONDITIONS.find((c) => c.value === "USED_GOOD")!.label;
    expect(toDescriptionHtml(makeItem({ description: "Size M <b>\nGreat\n\nNo flaws" }))).toBe(
      `<p>Size M &lt;b&gt;<br>Great</p><p>No flaws</p><p>Condition: ${condition}</p>`,
    );
  });

  it("needs a connected location and a price", () => {
    expect(validateForShopify(makeItem(), makeListing(), settings)).toEqual([]);
    expect(validateForShopify(makeItem({ priceCents: 0 }), makeListing({ overrides: {} }), {})).toEqual([
      "Reconnect your Shopify store.",
      "Set a price above zero.",
    ]);
  });
});

describe("Shopify adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates the product and reports its ids", async () => {
    const calls: { url: string; body: { variables: Record<string, unknown> } }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        expect((init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("access-token");
        return Response.json({
          data: {
            productSet: {
              product: { id: "gid://shopify/Product/123", variants: { nodes: [{ id: "gid://shopify/ProductVariant/456" }] } },
              userErrors: [],
            },
          },
        });
      }),
    );
    const onCreated = vi.fn();
    const result = await shopifyAdapter.upsertListing(makeItem(), makeListing(), shopifyConnection(), { onCreated });
    expect(result).toEqual({ remoteListingId: "123", remoteOfferId: "456" });
    expect(onCreated).toHaveBeenCalledWith("123");
    expect(calls[0].url).toMatch(/^https:\/\/mystore\.myshopify\.com\/admin\/api\/[\d-]+\/graphql\.json$/);
    expect(calls[0].body.variables.identifier).toBeUndefined();
  });

  it("reports Shopify's input errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ data: { productUpdate: { product: null, userErrors: [{ field: ["id"], message: "Product does not exist" }] } } }),
      ),
    );
    await expect(
      shopifyAdapter.endListing(makeListing({ remoteListingId: "123" }), shopifyConnection()),
    ).rejects.toThrow("Product does not exist");
  });
});

describe("Shopify orders", () => {
  const order = (overrides: Partial<ShopifyOrder> = {}): ShopifyOrder => ({
    id: "gid://shopify/Order/1001",
    createdAt: "2026-10-29T12:00:00Z",
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    totalShippingPriceSet: { shopMoney: { amount: "9.00", currencyCode: "USD" } },
    lineItems: {
      nodes: [
        {
          id: "gid://shopify/LineItem/1",
          sku: "JACKET-001",
          title: "Vintage denim jacket",
          quantity: 1,
          product: { id: "gid://shopify/Product/123" },
          discountedTotalSet: { shopMoney: { amount: "40.00", currencyCode: "USD" } },
        },
        {
          id: "gid://shopify/LineItem/2",
          sku: null,
          title: "Scarf",
          quantity: 2,
          product: null,
          discountedTotalSet: { shopMoney: { amount: "20.00", currencyCode: "USD" } },
        },
      ],
    },
    ...overrides,
  });

  it("turns a paid order into sold lines with shipping split by price", () => {
    const lines = orderToSales(order());
    expect(lines).toEqual([
      expect.objectContaining({ orderId: "1001", lineId: "1", sku: "JACKET-001", remoteListingId: "123", quantity: 1, priceCents: 4000, shippingCents: 600 }),
      expect.objectContaining({ lineId: "2", sku: null, remoteListingId: null, quantity: 2, priceCents: 2000, shippingCents: 300 }),
    ]);
  });

  it("skips cancelled and unpaid orders", () => {
    expect(orderToSales(order({ cancelledAt: "2026-10-29T13:00:00Z" }))).toEqual([]);
    expect(orderToSales(order({ displayFinancialStatus: "PENDING" }))).toEqual([]);
  });
});
