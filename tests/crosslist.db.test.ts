import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { channelListings, connections, itemImages, items, organizations } from "@/db/schema";

const user = { id: "", organizationId: "", email: "a@b.c", name: null };
vi.mock("@/lib/auth", () => ({ requireUser: async () => user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const syncItem = vi.fn(async () => [{ store: "Poshmark", action: "publish", ok: true }]);
vi.mock("@/lib/sync/run", () => ({ syncItem: (...args: unknown[]) => syncItem(...(args as [])) }));

const { crosslistItem } = await import("@/app/(app)/items/inventory-actions");
const { savePriceRules } = await import("@/app/(app)/stores/actions");

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("bulk crosslist and price rules", () => {
  let posh: string;
  let mercari: string;
  let active: string;
  let draft: string;
  let bare: string;

  beforeEach(async () => {
    await db.delete(organizations);
    syncItem.mockClear();
    const [org] = await db.insert(organizations).values({ name: "Mine" }).returning();
    user.organizationId = org.id;
    [{ id: posh }, { id: mercari }] = await db
      .insert(connections)
      .values([
        { organizationId: org.id, marketplace: "poshmark", environment: "production" },
        { organizationId: org.id, marketplace: "mercari", environment: "production" },
      ])
      .returning();
    const made = { organizationId: org.id, priceCents: 4000, description: "Nice.", brand: "Gap" };
    [{ id: active }, { id: draft }, { id: bare }] = await db
      .insert(items)
      .values([
        { ...made, sku: "A", title: "Coat", status: "active" },
        { ...made, sku: "B", title: "Hat", status: "draft" },
        { ...made, sku: "C", title: "Scarf", status: "draft" },
      ])
      .returning();
    await db.insert(itemImages).values([
      { itemId: active, url: "https://img.example/a.jpg", position: 0 },
      { itemId: draft, url: "https://img.example/b.jpg", position: 0 },
    ]);
    await db.insert(channelListings).values({ itemId: active, connectionId: posh, enabled: true, status: "listed" });
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  const ticked = async (itemId: string) =>
    (await db.select().from(channelListings).where(eq(channelListings.itemId, itemId))).filter((l) => l.enabled).map((l) => l.connectionId);

  it("ticks the stores and posts only to them on active items", async () => {
    expect(await crosslistItem(active, [mercari])).toEqual({ ok: true });
    expect((await ticked(active)).sort()).toEqual([posh, mercari].sort());
    expect(syncItem).toHaveBeenCalledTimes(1);
    expect(syncItem).toHaveBeenCalledWith(user.organizationId, active, { only: mercari });
  });

  it("posts drafts that are ready, and keeps the others as drafts with the reason", async () => {
    expect(await crosslistItem(draft, [posh, mercari])).toEqual({ ok: true });
    expect((await db.select().from(items).where(eq(items.id, draft)))[0].status).toBe("active");
    expect(syncItem).toHaveBeenCalledWith(user.organizationId, draft);

    const result = await crosslistItem(bare, [posh]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Add at least one photo");
    expect((await db.select().from(items).where(eq(items.id, bare)))[0].status).toBe("draft");
  });

  it("sets each store's price and shortens long titles", async () => {
    delete process.env.ANTHROPIC_API_KEY; // no AI here, so titles are cut at a whole word
    const long = "Vintage 1990s Levi's 501 straight leg denim jeans in light stonewash blue size 32 x 30 made in USA";
    await db.update(items).set({ title: long }).where(eq(items.id, active));
    await db.update(connections).set({ settings: { priceRule: { percent: 10, round: "none" } } }).where(eq(connections.id, posh));
    const result = await crosslistItem(active, [posh, mercari], {
      shortenTitles: true,
      prices: { [posh]: { mode: "match", percent: 0 }, [mercari]: { mode: "percent", percent: -25 } },
    });
    expect(result).toEqual({ ok: true });
    const rows = await db.select().from(channelListings).where(eq(channelListings.itemId, active));
    const on = (id: string) => rows.find((r) => r.connectionId === id)!.overrides;
    expect(on(posh).priceCents).toBe(4000);
    expect(on(mercari).priceCents).toBe(3000);
    expect(on(posh).title!.length).toBeLessThanOrEqual(80);
    expect(long.startsWith(on(posh).title!)).toBe(true);

    // "Price rule" takes a typed store price back off.
    await crosslistItem(active, [posh], { prices: { [posh]: { mode: "rule", percent: 0 } } });
    const [again] = await db.select().from(channelListings).where(eq(channelListings.connectionId, posh));
    expect(again.overrides.priceCents).toBeUndefined();
  });

  it("saves drafts without posting, and won't quietly post listed items", async () => {
    expect(await crosslistItem(draft, [mercari], { publish: false })).toEqual({ ok: true });
    expect(await ticked(draft)).toEqual([mercari]);
    expect((await db.select().from(items).where(eq(items.id, draft)))[0].status).toBe("draft");
    expect(syncItem).not.toHaveBeenCalled();

    const listed = await crosslistItem(active, [mercari], { publish: false });
    expect(listed.ok).toBe(false);
    expect(await ticked(active)).toEqual([posh]);
  });

  it("refuses other accounts' items and saves price rules", async () => {
    const form = new FormData();
    form.set(`percent_${posh}`, "10");
    form.set(`round_${posh}`, "99");
    expect(await savePriceRules(undefined, form)).toEqual({ saved: true });
    const [store] = await db.select().from(connections).where(eq(connections.id, posh));
    expect(store.settings.priceRule).toEqual({ percent: 10, round: "99" });
    form.set(`percent_${posh}`, "-95");
    expect(await savePriceRules(undefined, form)).toHaveProperty("error");

    const [other] = await db.insert(organizations).values({ name: "Other" }).returning();
    user.organizationId = other.id;
    expect(await crosslistItem(active, [mercari])).toEqual({ ok: false, message: "Item or store not found." });
  });
});
