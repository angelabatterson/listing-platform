import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { channelListings, connections, items, organizations, syncEvents } from "@/db/schema";
import { runEbayAutomations, watcherOffersDue } from "@/lib/automations/ebay";
import { encrypt } from "@/lib/crypto";

describe("watcherOffersDue", () => {
  const on = (lastRunAt?: string) => ({ automations: { watcherOffers: { enabled: true, discountPct: 10, lastRunAt } } });
  it("runs once a day, only when turned on", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    expect(watcherOffersDue({}, now)).toBe(false);
    expect(watcherOffersDue(on(), now)).toBe(true);
    expect(watcherOffersDue(on("2026-10-30T02:00:00Z"), now)).toBe(false);
    expect(watcherOffersDue(on("2026-10-29T12:00:00Z"), now)).toBe(true);
  });
});

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("offers to eBay watchers", () => {
  let ids: { org: string; ebay: string; item: string };
  const sent: string[] = [];

  beforeEach(async () => {
    await db.delete(organizations);
    sent.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string, init: RequestInit = {}) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/find_eligible_items")) {
          return new Response(JSON.stringify({ eligibleItems: [{ listingId: "E1" }, { listingId: "E2" }], total: 2 }));
        }
        const body = JSON.parse(String(init.body));
        sent.push(body.offeredItems[0].listingId);
        if (body.offeredItems[0].listingId === "E2") {
          return new Response(JSON.stringify({ errors: [{ message: "Listing isn't eligible" }] }), { status: 400 });
        }
        return new Response(JSON.stringify({ offers: [] }));
      }),
    );
    const [org] = await db.insert(organizations).values({ name: "Test" }).returning();
    const [ebay] = await db
      .insert(connections)
      .values({
        organizationId: org.id,
        marketplace: "ebay",
        environment: "sandbox",
        accessTokenEnc: encrypt("t"),
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        settings: { returnPolicyId: "r", automations: { watcherOffers: { enabled: true, discountPct: 15 } } },
      })
      .returning();
    const [item] = await db
      .insert(items)
      .values({ organizationId: org.id, sku: "J-1", title: "Jacket", priceCents: 4500, quantity: 1, status: "active" })
      .returning();
    await db.insert(channelListings).values({ itemId: item.id, connectionId: ebay.id, enabled: true, status: "listed", remoteListingId: "E1" });
    ids = { org: org.id, ebay: ebay.id, item: item.id };
  });

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await db.delete(organizations);
  });

  it("sends an offer per eligible listing, logs each one, and waits a day before the next run", async () => {
    const [result] = await runEbayAutomations();
    expect(result).toMatchObject({ connectionId: ids.ebay, sent: 1, failed: 1 });
    expect(sent).toEqual(["E1", "E2"]);

    const events = await db.query.syncEvents.findMany({ where: eq(syncEvents.connectionId, ids.ebay) });
    expect(events.find((e) => e.ok)).toMatchObject({ itemId: ids.item, action: "offer to watchers" });
    expect(events.find((e) => !e.ok)).toMatchObject({ itemId: null });

    const store = await db.query.connections.findFirst({ where: eq(connections.id, ids.ebay) });
    expect(store!.settings.returnPolicyId).toBe("r");
    expect(store!.settings.automations!.watcherOffers!.lastRunAt).toBeTruthy();

    expect(await runEbayAutomations()).toEqual([]);
    expect(sent).toHaveLength(2);
  });
});
