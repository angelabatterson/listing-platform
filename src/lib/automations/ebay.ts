import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { channelListings, connections, syncEvents, type Connection, type EbayConnectionSettings } from "@/db/schema";
import { findListingsWithWatchers, sendOfferToWatchers } from "@/lib/marketplaces/ebay/negotiation";

// Offers to watchers go out once a day. A little under 24 hours, so a run that lands a
// few minutes early on the next five-minute cron tick still counts.
const WATCHER_OFFER_GAP_MS = 23 * 60 * 60 * 1000;
// Keeps one cron run short; anything left over goes out the next day.
const MAX_OFFERS_PER_RUN = 100;

export function watcherOffersDue(settings: EbayConnectionSettings, now = new Date()): boolean {
  const w = settings.automations?.watcherOffers;
  if (!w?.enabled) return false;
  return !w.lastRunAt || now.getTime() - new Date(w.lastRunAt).getTime() >= WATCHER_OFFER_GAP_MS;
}

export async function sendWatcherOffers(connection: Connection): Promise<{ sent: number; failed: number }> {
  const w = connection.settings.automations!.watcherOffers!;
  // Marked first, so a run that fails partway doesn't repeat every five minutes.
  await db
    .update(connections)
    .set({
      settings: sql`jsonb_set(${connections.settings}, '{automations,watcherOffers,lastRunAt}', to_jsonb(${new Date().toISOString()}::text))`,
    })
    .where(eq(connections.id, connection.id));

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

// Called by the cron job.
export async function runEbayAutomations() {
  const stores = await db.query.connections.findMany({
    where: and(eq(connections.marketplace, "ebay"), eq(connections.status, "active")),
  });
  const results: { connectionId: string; sent?: number; failed?: number; error?: string }[] = [];
  for (const connection of stores) {
    if (!watcherOffersDue(connection.settings)) continue;
    try {
      results.push({ connectionId: connection.id, ...(await sendWatcherOffers(connection)) });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ connectionId: connection.id, error });
      await db.insert(syncEvents).values({
        organizationId: connection.organizationId,
        connectionId: connection.id,
        action: "offer to watchers",
        ok: false,
        message: `eBay: couldn't check for watchers. ${error}`,
      });
    }
  }
  return results;
}
