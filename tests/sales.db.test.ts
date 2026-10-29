import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { channelListings, connections, itemImages, items, organizations, sales, syncEvents } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { recordSales } from "@/lib/sync/sales";

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("selling an item on one store", () => {
  let ids: { org: string; ebay: string; etsy: string; item: string };
  const calls: string[] = [];

  beforeEach(async () => {
    await db.delete(organizations);
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string, init: RequestInit = {}) => {
        const url = new URL(String(input));
        calls.push(`${init.method ?? "GET"} ${url.host}${url.pathname} ${init.body ?? ""}`.trim());
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    const [org] = await db.insert(organizations).values({ name: "Test" }).returning();
    const token = {
      accessTokenEnc: encrypt("t"),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      environment: "sandbox",
      organizationId: org.id,
    };
    const [ebay] = await db
      .insert(connections)
      .values({
        ...token,
        marketplace: "ebay",
        settings: { merchantLocationKey: "default", fulfillmentPolicyId: "f", paymentPolicyId: "p", returnPolicyId: "r" },
      })
      .returning();
    const [etsy] = await db
      .insert(connections)
      .values({ ...token, marketplace: "etsy", settings: { shopId: "555" } })
      .returning();
    const [item] = await db
      .insert(items)
      .values({ organizationId: org.id, sku: "JACKET-001", title: "Jacket", priceCents: 4500, quantity: 1, status: "active" })
      .returning();
    await db.insert(itemImages).values({ itemId: item.id, url: "https://img.example/1.jpg" });
    await db.insert(channelListings).values([
      {
        itemId: item.id,
        connectionId: ebay.id,
        enabled: true,
        status: "listed",
        remoteListingId: "E1",
        remoteOfferId: "O1",
        overrides: { categoryId: "57988" },
      },
      { itemId: item.id, connectionId: etsy.id, enabled: true, status: "listed", remoteListingId: "9001" },
    ]);
    ids = { org: org.id, ebay: ebay.id, etsy: etsy.id, item: item.id };
  });

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await db.delete(organizations);
  });

  const ebaySale = { orderId: "ORD-1", lineId: "LINE-1", sku: "JACKET-001", remoteListingId: "E1", quantity: 1, soldAt: new Date() };

  it("lowers the quantity and takes the listing down on the other store only", async () => {
    const ebay = (await db.query.connections.findFirst({ where: eq(connections.id, ids.ebay) }))!;
    expect(await recordSales(ebay, [ebaySale])).toBe(1);

    const item = await db.query.items.findFirst({ where: eq(items.id, ids.item), with: { listings: true } });
    expect(item!.quantity).toBe(0);
    expect(calls).toEqual(["PATCH api.etsy.com/v3/application/shops/555/listings/9001 state=inactive"]);
    expect(item!.listings.map((l) => [l.connectionId, l.status]).sort()).toEqual(
      [
        [ids.ebay, "ended"],
        [ids.etsy, "ended"],
      ].sort(),
    );
    const events = await db.query.syncEvents.findMany({ where: eq(syncEvents.itemId, ids.item) });
    expect(events.map((e) => e.message)).toContain("Sold 1 on eBay. 0 left.");
  });

  it("keeps the sale's money and buyer for the dashboard", async () => {
    const ebay = (await db.query.connections.findFirst({ where: eq(connections.id, ids.ebay) }))!;
    await recordSales(ebay, [
      { ...ebaySale, title: "Jacket", currency: "USD", priceCents: 4500, shippingCents: 800, feesCents: 600, buyerId: "pat", buyerName: "Pat" },
    ]);
    expect(await db.select().from(sales)).toMatchObject([
      { title: "Jacket", priceCents: 4500, shippingCents: 800, feesCents: 600, feesEstimated: false, buyerId: "pat", buyerName: "Pat" },
    ]);
  });

  it("counts the same order line only once", async () => {
    const ebay = (await db.query.connections.findFirst({ where: eq(connections.id, ids.ebay) }))!;
    await recordSales(ebay, [ebaySale]);
    expect(await recordSales(ebay, [ebaySale])).toBe(0);
    expect(await db.select().from(sales)).toHaveLength(1);
  });

  it("updates the other store's quantity when stock remains", async () => {
    await db.update(items).set({ quantity: 3 }).where(eq(items.id, ids.item));
    const etsy = (await db.query.connections.findFirst({ where: eq(connections.id, ids.etsy) }))!;
    await recordSales(etsy, [{ ...ebaySale, remoteListingId: "9001", lineId: "T1" }]);

    const item = await db.query.items.findFirst({ where: eq(items.id, ids.item) });
    expect(item!.quantity).toBe(2);
    // eBay gets the new quantity (inventory item + offer); Etsy, where it sold, is left alone.
    expect(calls.map((c) => c.split(" ").slice(0, 2).join(" "))).toEqual([
      "PUT api.sandbox.ebay.com/sell/inventory/v1/inventory_item/JACKET-001",
      "PUT api.sandbox.ebay.com/sell/inventory/v1/offer/O1",
    ]);
  });

  it("flags an oversell", async () => {
    await db.update(items).set({ quantity: 0 }).where(eq(items.id, ids.item));
    const ebay = (await db.query.connections.findFirst({ where: eq(connections.id, ids.ebay) }))!;
    await recordSales(ebay, [ebaySale]);
    const events = await db.query.syncEvents.findMany({ where: eq(syncEvents.itemId, ids.item) });
    expect(events.find((e) => e.action === "sale")).toMatchObject({ ok: false });
  });

  it("ignores sales of things it doesn't manage", async () => {
    const ebay = (await db.query.connections.findFirst({ where: eq(connections.id, ids.ebay) }))!;
    expect(await recordSales(ebay, [{ ...ebaySale, sku: "OTHER", remoteListingId: "X", lineId: "L9" }])).toBe(0);
    expect(calls).toEqual([]);
  });
});
