import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { channelListings, connections, itemImages, items, organizations, photos, sales } from "@/db/schema";
import { photoUrl } from "@/lib/photos/links";

const user = { id: "", organizationId: "", email: "a@b.c" };
vi.mock("@/lib/auth", () => ({ requireUser: async () => user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/billing/access", () => ({ writeProblem: async () => null }));
vi.mock("@/lib/photos/store", () => ({ deletePhotoFiles: async () => {} }));
// Pretend every store takes the listing down, except a listing marked "stuck".
const syncItem = vi.fn(async (_org: string, itemId: string) => {
  const rows = await db.select().from(channelListings).where(eq(channelListings.itemId, itemId));
  for (const l of rows) {
    if (!l.enabled && l.status === "listed" && l.lastError !== "stuck") {
      await db.update(channelListings).set({ status: "ended" }).where(eq(channelListings.id, l.id));
    }
  }
  return [];
});
vi.mock("@/lib/sync/run", () => ({ syncItem: (...args: unknown[]) => syncItem(...(args as [string, string])) }));

const { addTagsToSelected, deleteSelected, delistSelected } = await import("@/app/(app)/items/bulk-actions");

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("the Inventory selection bar", () => {
  let org: string;
  let ebay: string;
  let posh: string;

  beforeEach(async () => {
    await db.delete(organizations);
    syncItem.mockClear();
    [{ id: org }] = await db.insert(organizations).values({ name: "Mine" }).returning();
    user.organizationId = org;
    [{ id: ebay }, { id: posh }] = await db
      .insert(connections)
      .values([
        { organizationId: org, marketplace: "ebay", environment: "production" },
        { organizationId: org, marketplace: "poshmark", environment: "production" },
      ])
      .returning();
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  const addItem = async (values: Partial<typeof items.$inferInsert> = {}) =>
    (
      await db
        .insert(items)
        .values({ organizationId: org, sku: `S-${Math.random()}`, title: "Denim jacket", priceCents: 4500, status: "active", ...values })
        .returning()
    )[0].id;
  const exists = async (id: string) => (await db.select().from(items).where(eq(items.id, id))).length === 1;

  it("deletes an unsold item after taking it off its stores, with its own photos", async () => {
    const id = await addItem();
    await db.insert(channelListings).values({ itemId: id, connectionId: ebay, enabled: true, status: "listed", remoteListingId: "123" });
    const [own, shared] = await db
      .insert(photos)
      .values([
        { organizationId: org, itemId: id, position: 0 },
        { organizationId: org, itemId: id, position: 0 },
      ])
      .returning();
    const other = await addItem({ title: "Other" });
    await db.insert(itemImages).values({ itemId: other, url: photoUrl(shared.id), position: 0 });

    expect(await deleteSelected(id)).toEqual({ ok: true });
    expect(syncItem).toHaveBeenCalledOnce();
    expect(await exists(id)).toBe(false);
    const left = (await db.select({ id: photos.id }).from(photos)).map((p) => p.id);
    expect(left).toEqual([shared.id]);
    expect(left).not.toContain(own.id);
  });

  it("never deletes a sold item", async () => {
    const soldOut = await addItem({ status: "sold_out" });
    const partly = await addItem({ quantity: 2 });
    await db.insert(sales).values({
      organizationId: org,
      connectionId: ebay,
      itemId: partly,
      externalOrderId: "o1",
      externalLineId: "l1",
      quantity: 1,
      soldAt: new Date(),
    });
    for (const id of [soldOut, partly]) {
      const r = await deleteSelected(id);
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/sold/);
      expect(await exists(id)).toBe(true);
    }
    expect(syncItem).not.toHaveBeenCalled();
  });

  it("keeps an item a store couldn't take down, and says where it's still up", async () => {
    const id = await addItem();
    await db
      .insert(channelListings)
      .values({ itemId: id, connectionId: posh, enabled: true, status: "listed", remoteUrl: "https://poshmark.com/x", lastError: "stuck" });
    const r = await deleteSelected(id);
    expect(r).toEqual({ ok: false, message: expect.stringContaining("still up on Poshmark") });
    expect(await exists(id)).toBe(true);
  });

  it("deletes a draft that was never listed without touching the stores", async () => {
    const id = await addItem({ status: "draft" });
    await db.insert(channelListings).values({ itemId: id, connectionId: ebay, enabled: true });
    expect(await deleteSelected(id)).toEqual({ ok: true });
    expect(syncItem).not.toHaveBeenCalled();
  });

  it("delists from every store and keeps the item", async () => {
    const id = await addItem();
    await db.insert(channelListings).values([
      { itemId: id, connectionId: ebay, enabled: true, status: "listed", remoteListingId: "1" },
      { itemId: id, connectionId: posh, enabled: true, status: "listed", remoteUrl: "https://poshmark.com/x" },
    ]);
    expect(await delistSelected(id)).toEqual({ ok: true });
    const rows = await db.select().from(channelListings).where(eq(channelListings.itemId, id));
    expect(rows.every((l) => !l.enabled && l.status === "ended")).toBe(true);
    expect(await exists(id)).toBe(true);
    expect(await delistSelected(id)).toEqual({ ok: true, message: "It wasn't on any store." });
  });

  it("adds tags to every ticked item, keeping their own, and only in this account", async () => {
    const a = await addItem({ tags: ["Bin 4"] });
    const b = await addItem();
    const r = await addTagsToSelected([a, b], "bin 4, Summer");
    expect(r.message).toBe("bin 4, Summer added to 2 items.");
    const tags = async (id: string) => (await db.select().from(items).where(eq(items.id, id)))[0].tags;
    expect(await tags(a)).toEqual(["Bin 4", "Summer"]);
    expect(await tags(b)).toEqual(["bin 4", "Summer"]);
    expect(await addTagsToSelected([a], " , ")).toHaveProperty("error");

    const [other] = await db.insert(organizations).values({ name: "Other" }).returning();
    user.organizationId = other.id;
    expect((await addTagsToSelected([a], "Mine")).message).toBe("Mine added to 0 items.");
    expect(await deleteSelected(a)).toEqual({ ok: true, message: "Already deleted." });
    user.organizationId = org;
    expect(await exists(a)).toBe(true);
  });
});
