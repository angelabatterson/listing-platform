import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tiktokAdapter } from "@/lib/marketplaces/tiktok/adapter";
import { signRequest } from "@/lib/marketplaces/tiktok/client";
import { toProduct, validateForTiktok } from "@/lib/marketplaces/tiktok/mapping";
import { orderToSales, type TiktokOrder } from "@/lib/marketplaces/tiktok/orders";
import { makeConnection, makeItem, makeListing } from "./fixtures";

const settings = { tiktokShopId: "7000", shopCipher: "ROW_abc", warehouseId: "WH1", packageWeightLb: 2 };
const tiktokConnection = () => makeConnection({ id: "conn-tiktok", marketplace: "tiktok", settings });

describe("TikTok Shop request signing", () => {
  it("signs the path, sorted parameters and body, wrapped in the secret", () => {
    const secret = "s3cret";
    const query = { timestamp: "1700000000", app_key: "key", shop_cipher: "ROW_abc", access_token: "skip", sign: "skip" };
    const body = '{"a":1}';
    const expected = createHmac("sha256", secret)
      .update(`${secret}/product/202309/productsapp_keykeyshop_cipherROW_abctimestamp1700000000${body}${secret}`)
      .digest("hex");
    expect(signRequest("/product/202309/products", query, body, secret)).toBe(expected);
  });
});

describe("TikTok Shop mapping", () => {
  it("builds one SKU with price, stock, weight and photos", () => {
    const body = toProduct(makeItem({ quantity: 3 }), makeListing({ overrides: {} }), settings, "601226", ["uri1", "uri2"]);
    expect(body).toMatchObject({
      title: "Vintage denim jacket",
      category_id: "601226",
      main_images: [{ uri: "uri1" }, { uri: "uri2" }],
      skus: [{ seller_sku: "JACKET-001", price: { amount: "45.50", currency: "USD" }, inventory: [{ warehouse_id: "WH1", quantity: 3 }] }],
      package_weight: { value: "2", unit: "POUND" },
    });
  });

  it("needs photos, a connected shop and a numeric category if one is given", () => {
    expect(validateForTiktok(makeItem(), makeListing({ overrides: {} }), settings)).toEqual([]);
    expect(validateForTiktok(makeItem({ images: [] }), makeListing({ overrides: { categoryId: "shoes" } }), {})).toEqual([
      "Add at least one photo.",
      "Reconnect your TikTok Shop.",
      "The TikTok Shop category ID should be a number.",
    ]);
  });
});

describe("TikTok Shop adapter", () => {
  beforeEach(() => {
    vi.stubEnv("TIKTOK_APP_ID", "app");
    vi.stubEnv("TIKTOK_APP_KEY", "key");
    vi.stubEnv("TIKTOK_APP_SECRET", "secret");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uploads photos, asks for a category, then creates the product", async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.hostname === "img.example") return new Response(new Blob(["jpg"]));
        paths.push(url.pathname);
        expect((init?.headers as Record<string, string>)["x-tts-access-token"]).toBe("access-token");
        expect(url.searchParams.get("shop_cipher")).toBe("ROW_abc");
        expect(url.searchParams.get("sign")).toMatch(/^[0-9a-f]{64}$/);
        const data = url.pathname.endsWith("/images/upload")
          ? { uri: `uri-${paths.length}` }
          : url.pathname.endsWith("/categories/recommend")
            ? { leaf_category_id: "601226" }
            : { product_id: "P1", skus: [{ id: "S1" }] };
        return Response.json({ code: 0, message: "Success", data });
      }),
    );
    const onCreated = vi.fn();
    const result = await tiktokAdapter.upsertListing(makeItem(), makeListing({ overrides: {} }), tiktokConnection(), { onCreated });
    expect(result).toEqual({ remoteListingId: "P1", remoteOfferId: "S1" });
    expect(onCreated).toHaveBeenCalledWith("P1");
    expect(paths.at(-1)).toBe("/product/202309/products");
    expect(paths.filter((p) => p.endsWith("/images/upload"))).toHaveLength(2);
  });

  it("updates a live product without a full edit", async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        paths.push(new URL(String(input)).pathname);
        return Response.json({ code: 0, data: {} });
      }),
    );
    await tiktokAdapter.upsertListing(
      makeItem(),
      makeListing({ remoteListingId: "P1", remoteOfferId: "S1", status: "listed" }),
      tiktokConnection(),
    );
    expect(paths).toEqual([
      "/product/202309/products/P1/partial_edit",
      "/product/202309/products/P1/prices/update",
      "/product/202309/products/P1/inventory/update",
    ]);
  });

  it("reports TikTok's error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: 12052048, message: "product not found" })));
    await expect(tiktokAdapter.endListing(makeListing({ remoteListingId: "P1" }), tiktokConnection())).rejects.toThrow(
      "product not found",
    );
  });
});

describe("TikTok Shop orders", () => {
  const order = (overrides: Partial<TiktokOrder> = {}): TiktokOrder => ({
    id: "576",
    status: "AWAITING_SHIPMENT",
    create_time: 1761739200,
    payment: { currency: "USD", shipping_fee: "6.00" },
    line_items: [
      { id: "L1", product_id: "P1", seller_sku: "JACKET-001", product_name: "Jacket", sale_price: "40.00", currency: "USD" },
      { id: "L2", product_id: "P2", seller_sku: "", product_name: "Scarf", sale_price: "20.00", currency: "USD" },
      { id: "L3", product_id: "P2", product_name: "Scarf", sale_price: "20.00", display_status: "CANCELLED" },
    ],
    ...overrides,
  });

  it("turns each unit into a sold line with shipping split by price", () => {
    expect(orderToSales(order())).toEqual([
      expect.objectContaining({ orderId: "576", lineId: "L1", sku: "JACKET-001", remoteListingId: "P1", quantity: 1, priceCents: 4000, shippingCents: 400 }),
      expect.objectContaining({ lineId: "L2", sku: null, priceCents: 2000, shippingCents: 200 }),
    ]);
  });

  it("skips unpaid and cancelled orders", () => {
    expect(orderToSales(order({ status: "UNPAID" }))).toEqual([]);
    expect(orderToSales(order({ status: "CANCELLED" }))).toEqual([]);
  });
});
