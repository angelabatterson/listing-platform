import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { channelListings, connections, itemImages, items, organizations } from "@/db/schema";
import type { SyncOutcome } from "@/lib/sync/run";

const user = { id: "", organizationId: "", email: "a@b.c" };
vi.mock("@/lib/auth", () => ({ requireUser: async () => user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
const syncItem = vi.fn<(...args: unknown[]) => Promise<SyncOutcome[]>>(async () => [
  { store: "Depop", action: "publish", ok: true, message: "Depop: ready to post" },
]);
vi.mock("@/lib/sync/run", () => ({ syncItem: (...args: unknown[]) => syncItem(...args) }));

const { loadStoreListing, removeFromStore, saveStoreListing } = await import("@/app/(app)/items/store-listing-actions");
const { saveItem } = await import("@/app/(app)/items/actions");

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) fd.append(k, one);
  return fd;
};

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("the List on [store] pop-up", () => {
  let itemId: string;
  let depopId: string;

  beforeEach(async () => {
    await db.delete(organizations);
    syncItem.mockClear();
    const [org] = await db.insert(organizations).values({ name: "Test" }).returning();
    user.organizationId = org.id;
    const [depop] = await db
      .insert(connections)
      .values({ organizationId: org.id, marketplace: "depop", environment: "production", status: "active" })
      .returning();
    depopId = depop.id;
    const [item] = await db
      .insert(items)
      .values({ organizationId: org.id, sku: "J-1", title: "Jacket", description: "Main description", priceCents: 4500, quantity: 1, status: "active", condition: "USED_GOOD" })
      .returning();
    itemId = item.id;
    await db.insert(itemImages).values([
      { itemId, url: "https://img.example/1.jpg", position: 0 },
      { itemId, url: "https://img.example/2.jpg", position: 1 },
    ]);
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  const listing = () =>
    db.query.channelListings.findFirst({ where: eq(channelListings.connectionId, depopId) });

  it("keeps only what differs from the main item, turns the store on, and syncs just that store", async () => {
    const result = await saveStoreListing(
      itemId,
      depopId,
      undefined,
      form({ title: "Jacket", description: "Depop words", price: "30", condition: "USED_GOOD", photo: "https://img.example/2.jpg" }),
    );
    expect(result).toEqual({ ok: true, message: "Depop: ready to post" });
    const saved = await listing();
    expect(saved!.enabled).toBe(true);
    expect(saved!.overrides).toEqual({ description: "Depop words", priceCents: 3000, imageUrls: ["https://img.example/2.jpg"] });
    expect(syncItem).toHaveBeenCalledWith(user.organizationId, itemId, { only: depopId });

    const loaded = await loadStoreListing(itemId, depopId);
    expect(loaded!.view).toMatchObject({ title: "Jacket", description: "Depop words", price: "30.00", photos: ["https://img.example/2.jpg"] });
    expect(loaded!.item.photos).toHaveLength(2);
  });

  it("asks for a photo when none is picked", async () => {
    const result = await saveStoreListing(itemId, depopId, undefined, form({ title: "Jacket", description: "", price: "45", condition: "USED_GOOD" }));
    expect(result).toEqual({ error: "Pick at least one photo." });
  });

  it("saves a draft item without listing it", async () => {
    await db.update(items).set({ status: "draft" }).where(eq(items.id, itemId));
    const result = await saveStoreListing(
      itemId,
      depopId,
      undefined,
      form({ title: "Jacket", description: "Main description", price: "45", condition: "USED_GOOD", photo: ["https://img.example/1.jpg", "https://img.example/2.jpg"] }),
    );
    expect(result?.message).toMatch(/Draft/);
    expect(syncItem).not.toHaveBeenCalled();
    expect((await listing())!.overrides).toEqual({});
  });

  it("keeps the store's changes when the main item is saved", async () => {
    await saveStoreListing(
      itemId,
      depopId,
      undefined,
      form({ title: "Depop title", description: "Main description", price: "45", condition: "USED_GOOD", photo: "https://img.example/1.jpg" }),
    );
    await saveItem(
      itemId,
      undefined,
      form({
        title: "Jacket",
        sku: "J-1",
        description: "Main description",
        price: "50",
        quantity: "1",
        condition: "USED_GOOD",
        status: "active",
        imageUrls: "https://img.example/1.jpg https://img.example/2.jpg",
        [`list_${depopId}`]: "on",
        [`price_${depopId}`]: "",
      }),
    );
    expect((await listing())!.overrides).toMatchObject({ title: "Depop title", imageUrls: ["https://img.example/1.jpg"] });
  });

  it("takes the item off the store", async () => {
    await db.insert(channelListings).values({ itemId, connectionId: depopId, enabled: true, status: "listed" });
    expect(await removeFromStore(itemId, depopId)).toEqual({ ok: true, message: "Taken off this store." });
    expect((await listing())!.enabled).toBe(false);
  });
});
