import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channelListings, connections, items, organizations, type Connection } from "@/db/schema";
import { importListings } from "@/lib/import";
import type { ImportedListing } from "@/lib/marketplaces/imported";

const listing = (id: string, extra: Partial<ImportedListing> = {}): ImportedListing => ({
  remoteListingId: id,
  sku: null,
  title: `Item ${id}`,
  description: "From the store",
  priceCents: 2000,
  currency: "USD",
  quantity: 1,
  photos: [`https://img.example/${id}.jpg`],
  overrides: { categoryId: "1050", whenMade: "1970s" },
  ...extra,
});

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("importing a store's live listings", () => {
  let org: string;
  let etsy: Connection;

  beforeEach(async () => {
    await db.delete(organizations);
    [{ id: org }] = await db.insert(organizations).values({ name: "Mine" }).returning();
    [etsy] = await db
      .insert(connections)
      .values({ organizationId: org, marketplace: "etsy", environment: "production", settings: { shopId: "1" } })
      .returning();
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  const all = () => db.query.items.findMany({ where: eq(items.organizationId, org), with: { images: true, listings: true }, orderBy: items.sku });

  it("adds new items linked to their live listing, and does nothing the second time", async () => {
    const counts = await importListings(etsy, [listing("1", { sku: "PX-1" }), listing("2"), null], null);
    expect(counts).toEqual({ created: 2, matched: 0, already: 0, unsupported: 1, overLimit: 0 });

    const [a, b] = await all();
    expect(a).toMatchObject({ sku: "ETSY-2", status: "active", images: [{ url: "https://img.example/2.jpg" }] });
    expect(b).toMatchObject({ sku: "PX-1", title: "Item 1", priceCents: 2000 });
    expect(b.listings).toEqual([
      expect.objectContaining({ enabled: true, status: "listed", remoteListingId: "1", overrides: { categoryId: "1050", whenMade: "1970s" } }),
    ]);

    expect(await importListings(etsy, [listing("1", { sku: "PX-1" }), listing("2")], null)).toMatchObject({ created: 0, already: 2 });
    expect(await all()).toHaveLength(2);
  });

  it("links a listing to an item already in Relistic by SKU or title, keeping the store's price", async () => {
    const [ebay] = await db.insert(connections).values({ organizationId: org, marketplace: "ebay", environment: "production" }).returning();
    const [bySku] = await db.insert(items).values({ organizationId: org, sku: "J-1", title: "Jacket", priceCents: 4500, status: "draft" }).returning();
    const [byTitle] = await db.insert(items).values({ organizationId: org, sku: "L-1", title: "Brass Lamp ", priceCents: 2000, status: "active" }).returning();
    await db.insert(channelListings).values({ itemId: byTitle.id, connectionId: ebay.id, enabled: true, status: "listed", remoteListingId: "e1" });

    const counts = await importListings(etsy, [listing("1", { sku: "J-1", priceCents: 3900 }), listing("2", { title: "brass lamp" })], null);
    expect(counts).toMatchObject({ created: 0, matched: 2 });

    const [jacket, lamp] = await all();
    // The draft becomes active, or its next save would take the live listing down.
    expect(jacket).toMatchObject({ id: bySku.id, status: "active", priceCents: 4500 });
    expect(jacket.listings[0]).toMatchObject({ remoteListingId: "1", overrides: { categoryId: "1050", whenMade: "1970s", priceCents: 3900 } });
    expect(lamp.listings.map((l) => l.remoteListingId).sort()).toEqual(["2", "e1"]);
    expect(lamp.listings.find((l) => l.remoteListingId === "2")?.overrides).not.toHaveProperty("priceCents");
  });

  it("doesn't link a second listing to an item that already has one on this store", async () => {
    await importListings(etsy, [listing("1", { sku: "J-1", title: "Jacket" })], null);
    const counts = await importListings(etsy, [listing("2", { sku: "J-1", title: "Jacket" })], null);
    expect(counts).toMatchObject({ created: 1, matched: 0 });
    expect((await all()).map((i) => i.sku)).toEqual(["ETSY-2", "J-1"]);
  });

  it("stops adding active items at the plan's limit, but still adds sold-out ones", async () => {
    const counts = await importListings(etsy, [listing("1"), listing("2"), listing("3", { quantity: 0 })], 1);
    expect(counts).toMatchObject({ created: 2, overLimit: 1 });
    expect((await all()).map((i) => i.status).sort()).toEqual(["active", "sold_out"]);
  });
});
