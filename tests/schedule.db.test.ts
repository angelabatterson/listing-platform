import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { channelListings, connections, itemImages, items, organizations, syncEvents, users } from "@/db/schema";

const user = { id: "", organizationId: "", email: "a@b.c", name: null };
vi.mock("@/lib/auth", () => ({ requireUser: async () => user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const syncItem = vi.fn(async () => []);
vi.mock("@/lib/sync/run", () => ({ syncItem: (...args: unknown[]) => syncItem(...(args as [])) }));

const { cancelSchedule, postDraft, scheduleDrafts } = await import("@/app/(app)/batches/actions");
const { postScheduledDrafts } = await import("@/lib/sync/scheduled");

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("scheduled listings", () => {
  let org: string;
  let store: string;
  let ready: string;
  let unready: string;

  beforeEach(async () => {
    await db.delete(organizations);
    syncItem.mockClear();
    [{ id: org }] = await db.insert(organizations).values({ name: "Mine" }).returning();
    user.organizationId = org;
    [{ id: user.id }] = await db.insert(users).values({ organizationId: org, email: "a@b.c", passwordHash: "x" }).returning();
    [{ id: store }] = await db
      .insert(connections)
      .values({ organizationId: org, marketplace: "poshmark", environment: "production" })
      .returning();
    [{ id: ready }, { id: unready }] = await db
      .insert(items)
      .values([
        { organizationId: org, sku: "A-1", title: "Wool coat", priceCents: 9000, status: "draft", description: "Warm.", brand: "Gap" },
        { organizationId: org, sku: "A-2", title: "Hat", priceCents: 1500, status: "draft", description: "Wool.", brand: "Gap" },
      ])
      .returning();
    await db.insert(channelListings).values({ itemId: ready, connectionId: store, enabled: true });
    await db.insert(itemImages).values([
      { itemId: ready, url: "https://img.example/1.jpg", position: 0 },
      { itemId: unready, url: "https://img.example/2.jpg", position: 0 },
    ]);
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  const item = async (id: string) => (await db.select().from(items).where(eq(items.id, id)))[0];
  const soon = new Date(Date.now() + 3600_000).toISOString();

  it("schedules ready drafts, skips ones with problems, and cancels", async () => {
    const result = await scheduleDrafts([
      { itemId: ready, at: soon },
      { itemId: unready, at: soon },
    ]);
    expect(result.scheduled).toBe(1);
    expect(result.problems?.[0]).toContain("Hat: Pick at least one store");
    expect((await item(ready)).scheduledAt?.toISOString()).toBe(soon);
    expect((await item(unready)).scheduledAt).toBeNull();

    expect(await scheduleDrafts([{ itemId: ready, at: "2020-01-01T00:00:00Z" }])).toHaveProperty("error");
    expect(await cancelSchedule(ready)).toEqual({});
    expect((await item(ready)).scheduledAt).toBeNull();
  });

  it("posts drafts when their time comes, once, and clears the schedule on a manual post", async () => {
    await db.update(items).set({ scheduledAt: new Date(Date.now() - 60_000) }).where(eq(items.id, ready));
    await db.update(items).set({ scheduledAt: new Date(Date.now() + 86_400_000) }).where(eq(items.id, unready));
    expect(await postScheduledDrafts()).toEqual({ due: 1, posted: 1, failed: 0 });
    expect(await item(ready)).toMatchObject({ status: "active", scheduledAt: null });
    expect(syncItem).toHaveBeenCalledWith(org, ready);
    expect(await postScheduledDrafts()).toEqual({ due: 0, posted: 0, failed: 0 });

    // Posting by hand takes it off the schedule.
    await db.update(items).set({ scheduledAt: new Date(Date.now() + 86_400_000) }).where(eq(items.id, unready));
    await db.insert(channelListings).values({ itemId: unready, connectionId: store, enabled: true });
    expect(await postDraft(unready)).toEqual({ itemId: unready, failed: undefined });
    expect((await item(unready)).scheduledAt).toBeNull();
  });

  it("takes a draft that can't post off the schedule and says why in Activity", async () => {
    await db.update(items).set({ scheduledAt: new Date(Date.now() - 60_000) }).where(eq(items.id, unready));
    expect(await postScheduledDrafts()).toEqual({ due: 1, posted: 0, failed: 1 });
    expect(await item(unready)).toMatchObject({ status: "draft", scheduledAt: null });
    const [event] = await db.select().from(syncEvents).where(eq(syncEvents.itemId, unready));
    expect(event).toMatchObject({ ok: false, action: "scheduled_post" });
    expect(event.message).toContain("Pick at least one store");
    expect(syncItem).not.toHaveBeenCalled();
  });
});
