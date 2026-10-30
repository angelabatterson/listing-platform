import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channelListings, connections, extensionTasks, itemImages, items, organizations, users } from "@/db/schema";
import { GET as getTasks } from "@/app/api/extension/tasks/route";
import { POST as reportTask } from "@/app/api/extension/tasks/[id]/route";
import { POST as reportSignIns } from "@/app/api/extension/me/route";
import { createExtensionKey } from "@/lib/extension/keys";
import { syncItem } from "@/lib/sync/run";

const api = (key: string | null, path: string, body?: unknown) =>
  new Request(`https://app.example${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...(key && { authorization: `Bearer ${key}` }), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

type TaskList = { tasks: { id: string; kind: string; marketplace: string; listing: { title: string; priceCents: number; photos: string[] } }[] };

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("posting through the Chrome extension", () => {
  let ids: { org: string; posh: string; item: string; listing: string };
  let key: string;

  const tasks = async (k: string | null = key) => {
    const res = await getTasks(api(k, "/api/extension/tasks"));
    return { status: res.status, body: (await res.json()) as TaskList };
  };
  const report = async (taskId: string, body: unknown, k: string = key) =>
    reportTask(api(k, `/api/extension/tasks/${taskId}`, body), { params: Promise.resolve({ id: taskId }) });
  const listing = async () => (await db.query.channelListings.findFirst({ where: eq(channelListings.id, ids.listing) }))!;

  beforeEach(async () => {
    await db.delete(organizations);
    const [org] = await db.insert(organizations).values({ name: "Mine" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org.id, email: "me@example.com", passwordHash: "x" }).returning();
    const [posh] = await db
      .insert(connections)
      .values({ organizationId: org.id, marketplace: "poshmark", environment: "production" })
      .returning();
    const [item] = await db
      .insert(items)
      .values({ organizationId: org.id, sku: "J-1", title: "Jacket", description: "Denim, size M.", priceCents: 4500, status: "active" })
      .returning();
    await db.insert(itemImages).values({ itemId: item.id, url: "https://img.example/1.jpg" });
    const [l] = await db.insert(channelListings).values({ itemId: item.id, connectionId: posh.id, enabled: true }).returning();
    ids = { org: org.id, posh: posh.id, item: item.id, listing: l.id };
    key = await createExtensionKey(user);
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  it("queues a listing for the extension once, and requeues it only when the item changes", async () => {
    const [outcome] = await syncItem(ids.org, ids.item);
    expect(outcome).toMatchObject({ store: "Poshmark", ok: true, message: expect.stringMatching(/waiting for you to post/) });
    expect((await listing()).status).toBe("waiting");

    await syncItem(ids.org, ids.item);
    expect(await db.select().from(extensionTasks)).toHaveLength(1);

    await db.update(items).set({ priceCents: 3900 }).where(eq(items.id, ids.item));
    await syncItem(ids.org, ids.item);
    const all = await db.select().from(extensionTasks);
    expect(all.map((t) => t.status).sort()).toEqual(["cancelled", "open"]);

    const { status, body } = await tasks();
    expect(status).toBe(200);
    expect(body.tasks).toEqual([
      expect.objectContaining({ kind: "list", marketplace: "poshmark", listing: expect.objectContaining({ title: "Jacket", priceCents: 3900, photos: ["https://img.example/1.jpg"] }) }),
    ]);
  });

  it("records the posted listing, then asks the extension to take it down when it sells", async () => {
    await syncItem(ids.org, ids.item);
    const [task] = (await tasks()).body.tasks;
    const res = await report(task.id, { result: "done", remoteListingId: "abc123", url: "https://poshmark.com/listing/Jacket-abc123" });
    expect(res.status).toBe(200);
    expect(await listing()).toMatchObject({ status: "listed", remoteListingId: "abc123", remoteUrl: "https://poshmark.com/listing/Jacket-abc123" });

    // Saving the item again without changes asks for nothing.
    expect(await syncItem(ids.org, ids.item)).toEqual([]);
    expect((await tasks()).body.tasks).toEqual([]);

    // Sold elsewhere: quantity 0.
    await db.update(items).set({ quantity: 0, status: "sold_out" }).where(eq(items.id, ids.item));
    await syncItem(ids.org, ids.item);
    const [end] = (await tasks()).body.tasks;
    expect(end.kind).toBe("end");
    await report(end.id, { result: "done" });
    expect((await listing()).status).toBe("ended");
  });

  it("drops a waiting listing when the store is unticked, and skipping puts it back", async () => {
    await syncItem(ids.org, ids.item);
    await db.update(channelListings).set({ enabled: false }).where(eq(channelListings.id, ids.listing));
    await syncItem(ids.org, ids.item);
    expect((await listing()).status).toBe("not_listed");
    expect((await tasks()).body.tasks).toEqual([]);

    await db.update(channelListings).set({ enabled: true }).where(eq(channelListings.id, ids.listing));
    await syncItem(ids.org, ids.item);
    const [task] = (await tasks()).body.tasks;
    await report(task.id, { result: "skipped" });
    expect((await listing()).status).toBe("not_listed");
  });

  it("doesn't queue a listing the store would reject", async () => {
    await db.delete(itemImages).where(eq(itemImages.itemId, ids.item));
    await db.update(items).set({ priceCents: 200 }).where(eq(items.id, ids.item));
    const [outcome] = await syncItem(ids.org, ids.item);
    expect(outcome.ok).toBe(false);
    expect((await listing()).lastError).toMatch(/at least one photo.*at least \$3\.00/);
    expect((await tasks()).body.tasks).toEqual([]);
  });

  it("checks each store's own limits", async () => {
    await db.update(connections).set({ marketplace: "mercari" }).where(eq(connections.id, ids.posh));
    await db.update(items).set({ title: "x".repeat(81) }).where(eq(items.id, ids.item));
    const [outcome] = await syncItem(ids.org, ids.item);
    expect(outcome).toMatchObject({ store: "Mercari", ok: false });
    expect((await listing()).lastError).toMatch(/80 characters or fewer/);
  });

  it("saves which stores you're signed in to in Chrome, and answers with the added stores", async () => {
    const res = await reportSignIns(api(key, "/api/extension/me", { signedIn: { poshmark: true, depop: false } }));
    expect(await res.json()).toEqual({ email: "me@example.com", stores: [{ marketplace: "poshmark", name: "Poshmark" }] });
    const posh = await db.query.connections.findFirst({ where: eq(connections.id, ids.posh) });
    expect(posh!.settings.chromeSignIn).toMatchObject({ signedIn: true });

    const bad = await reportSignIns(api(key, "/api/extension/me", { signedIn: { poshmark: "yes" } }));
    expect(bad.status).toBe(400);
    expect((await reportSignIns(api("nope", "/api/extension/me", { signedIn: {} }))).status).toBe(401);
  });

  it("only answers a key for the account that made it", async () => {
    await syncItem(ids.org, ids.item);
    const [task] = (await tasks()).body.tasks;
    expect((await tasks(null)).status).toBe(401);
    expect((await tasks("rlx_not-a-real-key")).status).toBe(401);

    const [other] = await db.insert(organizations).values({ name: "Theirs" }).returning();
    const [them] = await db.insert(users).values({ organizationId: other.id, email: "them@example.com", passwordHash: "x" }).returning();
    const theirKey = await createExtensionKey(them);
    expect((await tasks(theirKey)).body.tasks).toEqual([]);
    expect((await report(task.id, { result: "done" }, theirKey)).status).toBe(404);
    expect((await listing()).status).toBe("waiting");
  });
});
