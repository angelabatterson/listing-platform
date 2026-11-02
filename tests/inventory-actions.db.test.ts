import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { channelListings, connections, items, organizations } from "@/db/schema";

const user = { id: "", organizationId: "", email: "a@b.c" };
vi.mock("@/lib/auth", () => ({ requireUser: async () => user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const syncItem = vi.fn(async () => [{ store: "Poshmark", action: "publish", ok: true }]);
vi.mock("@/lib/sync/run", () => ({ syncItem: (...args: unknown[]) => syncItem(...(args as [])) }));

const { discardFailed, findItems, moveListing, retryFailed, saveRowDetails, setFavorite, setNotDuplicate } = await import(
  "@/app/(app)/items/inventory-actions"
);

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("fixing things from the Inventory list", () => {
  let store: string;
  let jacket: string;
  let copy: string;

  beforeEach(async () => {
    await db.delete(organizations);
    syncItem.mockClear();
    const [org] = await db.insert(organizations).values({ name: "Mine" }).returning();
    user.organizationId = org.id;
    [{ id: store }] = await db
      .insert(connections)
      .values({ organizationId: org.id, marketplace: "poshmark", environment: "production" })
      .returning();
    [{ id: jacket }, { id: copy }] = await db
      .insert(items)
      .values([
        { organizationId: org.id, sku: "J-1", title: "Denim jacket", priceCents: 4500, status: "active" },
        { organizationId: org.id, sku: "J-2", title: "Denim jacket (copy)", priceCents: 4500, status: "active" },
      ])
      .returning();
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  const item = async (id: string) => (await db.select().from(items).where(eq(items.id, id)))[0];

  it("saves favorites, notes and cost, and checks the cost", async () => {
    await setFavorite(jacket, true);
    expect(await saveRowDetails(jacket, { notes: "  Missing weight ", cost: "4.5" })).toEqual({});
    expect(await item(jacket)).toMatchObject({ favorite: true, notes: "Missing weight", costCents: 450 });
    expect(await saveRowDetails(jacket, { cost: "" })).toEqual({});
    expect((await item(jacket)).costCents).toBeNull();
    expect(await saveRowDetails(jacket, { cost: "lots" })).toHaveProperty("error");
    expect(await setNotDuplicate(jacket)).toEqual({});
    expect((await item(jacket)).notDuplicate).toBe(true);

    const [other] = await db.insert(organizations).values({ name: "Other" }).returning();
    user.organizationId = other.id;
    expect(await setFavorite(copy, true)).toEqual({ error: "Item not found." });
    expect(await findItems("denim", jacket)).toEqual([]);
  });

  it("retries failed listings, and discards them without touching live ones", async () => {
    await db.insert(channelListings).values([
      { itemId: jacket, connectionId: store, enabled: true, status: "error", lastError: "Photo too small" },
      { itemId: copy, connectionId: store, enabled: true, status: "error", lastError: "Price", remoteListingId: "p-9" },
    ]);
    expect((await retryFailed()).message).toBe("2 of 2 listings went through.");
    expect(syncItem).toHaveBeenCalledWith(user.organizationId, jacket, { only: store });

    expect((await discardFailed()).message).toBe("Cleared 2 problems.");
    const rows = await db.select().from(channelListings);
    expect(rows.find((r) => r.itemId === jacket)).toMatchObject({ enabled: false, status: "not_listed", lastError: null });
    expect(rows.find((r) => r.itemId === copy)).toMatchObject({ enabled: true, status: "listed", lastError: null });
  });

  it("moves a store listing to another item, unless that item has its own", async () => {
    await db.insert(channelListings).values({ itemId: copy, connectionId: store, enabled: true, status: "listed", remoteListingId: "p-1" });
    expect(await findItems("jacket", copy)).toEqual([{ id: jacket, title: "Denim jacket", sku: "J-1" }]);
    expect(await moveListing(copy, store, jacket)).toEqual({ message: 'Moved to "Denim jacket".' });
    const [moved] = await db.select().from(channelListings);
    expect(moved).toMatchObject({ itemId: jacket, remoteListingId: "p-1" });

    await db.insert(channelListings).values({ itemId: copy, connectionId: store, enabled: true, status: "listed", remoteListingId: "p-2" });
    expect(await moveListing(copy, store, jacket)).toEqual({ error: "That item already has its own listing on this store." });
  });
});
