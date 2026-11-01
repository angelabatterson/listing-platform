import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { batches, itemImages, items, organizations, photos } from "@/db/schema";
import { photoUrl } from "@/lib/photos/links";

const user = { id: "", organizationId: "", email: "a@b.c" };
vi.mock("@/lib/auth", () => ({ requireUser: async () => user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

const { deleteBatch, deletePhotos } = await import("@/app/(app)/batches/actions");

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("deleting photos and batches", () => {
  let org: string;
  let batchId: string;
  let loose: string[];
  let onItem: string;
  let edited: string;
  let itemId: string;

  beforeEach(async () => {
    await db.delete(organizations);
    redirect.mockClear();
    [{ id: org }] = await db.insert(organizations).values({ name: "Mine" }).returning();
    user.organizationId = org;
    [{ id: batchId }] = await db.insert(batches).values({ organizationId: org, number: 3 }).returning();
    [{ id: itemId }] = await db
      .insert(items)
      .values({ organizationId: org, sku: "B3-1", title: "Coat", priceCents: 1000, batchId })
      .returning();
    const rows = await db
      .insert(photos)
      .values([0, 1, 2, 3, 4].map((position) => ({ organizationId: org, batchId, position })))
      .returning({ id: photos.id });
    loose = [rows[0].id, rows[1].id, rows[2].id];
    onItem = rows[3].id;
    // A background edit: no item of its own yet, but the item links to it.
    edited = rows[4].id;
    await db.update(photos).set({ itemId }).where(eq(photos.id, onItem));
    await db.insert(itemImages).values([
      { itemId, url: photoUrl(onItem), position: 0 },
      { itemId, url: photoUrl(edited), position: 1 },
    ]);
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  const photoIds = async () => (await db.select({ id: photos.id }).from(photos)).map((p) => p.id).sort();

  it("deletes several picked photos, but never one already on an item or another account's", async () => {
    const [other] = await db.insert(organizations).values({ name: "Other" }).returning();
    user.organizationId = other.id;
    await deletePhotos(loose);
    expect(await photoIds()).toHaveLength(5);

    user.organizationId = org;
    await deletePhotos([loose[0], loose[1], onItem]);
    expect(await photoIds()).toEqual([loose[2], onItem, edited].sort());
  });

  it("deletes a batch and its loose photos, keeping items and the photos they use", async () => {
    await deleteBatch(batchId);
    expect(redirect).toHaveBeenCalledWith("/batches");
    expect(await db.select().from(batches)).toHaveLength(0);
    expect(await photoIds()).toEqual([onItem, edited].sort());
    const [item] = await db.select().from(items);
    expect(item).toMatchObject({ id: itemId, batchId: null });
    expect((await db.select().from(photos)).every((p) => p.batchId === null)).toBe(true);
  });

  it("won't delete another account's batch", async () => {
    const [other] = await db.insert(organizations).values({ name: "Other" }).returning();
    user.organizationId = other.id;
    await deleteBatch(batchId);
    expect(await db.select().from(batches)).toHaveLength(1);
    expect(await photoIds()).toHaveLength(5);
  });
});
