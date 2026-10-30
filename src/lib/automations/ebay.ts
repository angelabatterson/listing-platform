import "server-only";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { channelListings, connections, items, syncEvents, type Connection, type EbayConnectionSettings } from "@/db/schema";
import { ebayAdapter } from "@/lib/marketplaces/ebay/adapter";
import { findListingsWithWatchers, sendOfferToWatchers } from "@/lib/marketplaces/ebay/negotiation";
import { syncItem } from "@/lib/sync/run";

// Offers to watchers and relisting run once a day. A little under 24 hours, so a run that
// lands a few minutes early on the next five-minute cron tick still counts.
const DAILY_GAP_MS = 23 * 60 * 60 * 1000;
// Keeps one cron run short; anything left over goes out the next day.
const MAX_OFFERS_PER_RUN = 100;

const dueDaily = (task: { enabled: boolean; lastRunAt?: string } | undefined, now: Date) =>
  Boolean(task?.enabled) && (!task!.lastRunAt || now.getTime() - new Date(task!.lastRunAt).getTime() >= DAILY_GAP_MS);

export function watcherOffersDue(settings: EbayConnectionSettings, now = new Date()): boolean {
  return dueDaily(settings.automations?.watcherOffers, now);
}

export function relistDue(settings: EbayConnectionSettings, now = new Date()): boolean {
  return dueDaily(settings.automations?.relist, now);
}

// Marked before the work starts, so a run that fails partway doesn't repeat every five minutes.
async function markRun(connection: Connection, task: "watcherOffers" | "relist") {
  await db
    .update(connections)
    .set({
      settings: sql`jsonb_set(${connections.settings}, ${`{automations,${task},lastRunAt}`}::text[], to_jsonb(${new Date().toISOString()}::text))`,
    })
    .where(eq(connections.id, connection.id));
}

export async function sendWatcherOffers(connection: Connection): Promise<{ sent: number; failed: number }> {
  const w = connection.settings.automations!.watcherOffers!;
  await markRun(connection, "watcherOffers");

  const listingIds = await findListingsWithWatchers(connection, MAX_OFFERS_PER_RUN);
  const ours = listingIds.length
    ? await db
        .select({ remoteListingId: channelListings.remoteListingId, itemId: channelListings.itemId })
        .from(channelListings)
        .where(and(eq(channelListings.connectionId, connection.id), inArray(channelListings.remoteListingId, listingIds)))
    : [];
  const itemFor = new Map(ours.map((l) => [l.remoteListingId, l.itemId]));

  let sent = 0;
  let failed = 0;
  for (const listingId of listingIds) {
    let ok = true;
    let message = `eBay: sent a ${w.discountPct}% off offer to watchers of listing ${listingId}.`;
    try {
      await sendOfferToWatchers(connection, listingId, w.discountPct, w.message);
      sent++;
    } catch (err) {
      ok = false;
      failed++;
      message = `eBay: couldn't send an offer to watchers of listing ${listingId}. ${err instanceof Error ? err.message : err}`;
    }
    await db.insert(syncEvents).values({
      organizationId: connection.organizationId,
      itemId: itemFor.get(listingId) ?? null,
      connectionId: connection.id,
      action: "offer to watchers",
      ok,
      message,
    });
  }
  return { sent, failed };
}

// The next price for a relist: lower by `dropPct`, but not under `floorPct` of the item's
// price, and never higher than it is now.
export function relistPrice(currentCents: number, itemCents: number, dropPct: number, floorPct: number): number {
  const dropped = Math.round((currentCents * (100 - dropPct)) / 100);
  const floor = Math.round((itemCents * floorPct) / 100);
  return Math.min(currentCents, Math.max(dropped, floor));
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// End listings that have been up `afterDays` without selling and list them again, so they
// show as new in eBay search, with a lower price if the seller chose one.
export async function relistStaleListings(connection: Connection): Promise<{ relisted: number; failed: number }> {
  const r = connection.settings.automations!.relist!;
  await markRun(connection, "relist");
  const cutoff = new Date(Date.now() - r.afterDays * 24 * 60 * 60 * 1000);
  const listedSince = sql`coalesce(${channelListings.listedAt}, ${channelListings.createdAt})`;
  const stale = await db
    .select({ listing: channelListings, item: { priceCents: items.priceCents } })
    .from(channelListings)
    .innerJoin(items, eq(items.id, channelListings.itemId))
    .where(
      and(
        eq(channelListings.connectionId, connection.id),
        eq(channelListings.enabled, true),
        eq(channelListings.status, "listed"),
        eq(items.status, "active"),
        gt(items.quantity, 0),
        lt(listedSince, cutoff.toISOString()),
      ),
    )
    .orderBy(asc(listedSince))
    .limit(r.perDay);

  let relisted = 0;
  let failed = 0;
  for (const { listing, item } of stale) {
    const before = listing.overrides.priceCents ?? item.priceCents;
    const after = relistPrice(before, item.priceCents, r.dropPct, r.floorPct);
    const log = (ok: boolean, message: string) =>
      db.insert(syncEvents).values({
        organizationId: connection.organizationId,
        itemId: listing.itemId,
        connectionId: connection.id,
        action: "relist",
        ok,
        message,
      });
    try {
      await ebayAdapter.endListing(listing, connection);
    } catch (err) {
      failed++;
      await log(false, `eBay: couldn't end listing ${listing.remoteListingId} to relist it. ${err instanceof Error ? err.message : err}`);
      continue;
    }
    await db
      .update(channelListings)
      .set({ status: "ended", overrides: { ...listing.overrides, priceCents: after === item.priceCents ? undefined : after } })
      .where(eq(channelListings.id, listing.id));
    const [outcome] = await syncItem(connection.organizationId, listing.itemId, { only: connection.id });
    if (outcome?.ok) {
      relisted++;
      await log(true, `eBay: relisted at ${money(after)}${after < before ? ` (was ${money(before)})` : ""}.`);
    } else {
      failed++;
      await log(false, `eBay: ended the old listing but couldn't list it again. ${outcome?.message ?? ""} Press Sync on the item to try again.`);
    }
  }
  return { relisted, failed };
}

type Task = { due: (s: EbayConnectionSettings) => boolean; run: (c: Connection) => Promise<Record<string, number>>; action: string; failure: string };

const TASKS: Task[] = [
  { due: watcherOffersDue, run: sendWatcherOffers, action: "offer to watchers", failure: "couldn't check for watchers" },
  { due: relistDue, run: relistStaleListings, action: "relist", failure: "couldn't look for listings to relist" },
];

// Called by the cron job.
export async function runEbayAutomations() {
  const stores = await db.query.connections.findMany({
    where: and(eq(connections.marketplace, "ebay"), eq(connections.status, "active")),
  });
  const results: ({ connectionId: string; action: string; error?: string } & Record<string, unknown>)[] = [];
  for (const store of stores) {
    for (const task of TASKS) {
      // Re-read, so one task's lastRunAt isn't lost when the next writes settings.
      const connection = (await db.query.connections.findFirst({ where: eq(connections.id, store.id) }))!;
      if (!task.due(connection.settings)) continue;
      try {
        results.push({ connectionId: connection.id, action: task.action, ...(await task.run(connection)) });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({ connectionId: connection.id, action: task.action, error });
        await db.insert(syncEvents).values({
          organizationId: connection.organizationId,
          connectionId: connection.id,
          action: task.action,
          ok: false,
          message: `eBay: ${task.failure}. ${error}`,
        });
      }
    }
  }
  return results;
}
