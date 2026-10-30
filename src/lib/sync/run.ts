import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channelListings, items, syncEvents } from "@/db/schema";
import { cancelOpenTasks, planExtensionWork } from "@/lib/extension/tasks";
import { adapterFor, MARKETPLACE_LABELS } from "@/lib/marketplaces";
import { isExtensionMarketplace } from "@/lib/marketplaces/labels";
import { forStore } from "@/lib/marketplaces/overrides";
import { planChannelAction } from "./plan";

export type SyncOutcome = { store: string; action: string; ok: boolean; message?: string };

// Push one item's current state to every store it's connected to.
// `only` limits the push to one store, for changes that concern that store alone.
// `soldOn` is the store a sale came from: that marketplace has already lowered its
// own quantity (or ended the listing), so it's left alone.
export async function syncItem(
  organizationId: string,
  itemId: string,
  options: { soldOn?: string; only?: string } = {},
): Promise<SyncOutcome[]> {
  const item = await db.query.items.findFirst({
    where: and(eq(items.id, itemId), eq(items.organizationId, organizationId)),
    with: { images: true, listings: { with: { connection: true } } },
  });
  if (!item) throw new Error("Item not found");

  const outcomes: SyncOutcome[] = [];
  for (const { connection, ...listing } of item.listings) {
    if (options.only && connection.id !== options.only) continue;
    const store = MARKETPLACE_LABELS[connection.marketplace];
    const action = planChannelAction(item, listing);
    const viaExtension = isExtensionMarketplace(connection.marketplace);
    if (action === "none" && !viaExtension) continue;
    if (connection.id === options.soldOn) {
      if (viaExtension) await cancelOpenTasks(listing.id);
      if (action === "end") {
        await db
          .update(channelListings)
          .set({ status: "ended", lastSyncedAt: new Date(), lastError: null })
          .where(eq(channelListings.id, listing.id));
      }
      continue;
    }

    let ok = true;
    let message: string | undefined;
    if (viaExtension) {
      // Checked here too, so a listing the store would reject isn't handed to the seller.
      const problems =
        action !== "publish"
          ? []
          : connection.status !== "active"
            ? [`Add ${store} again on the Stores page first.`]
            : adapterFor(connection.marketplace).validate(forStore(item, listing), listing, connection);
      if (problems.length) {
        ok = false;
        message = `${store}: ${problems.join(" ")}`;
        await cancelOpenTasks(listing.id);
        await db
          .update(channelListings)
          .set({ status: "error", lastError: problems.join(" "), lastSyncedAt: new Date() })
          .where(eq(channelListings.id, listing.id));
      } else {
        const queued = await planExtensionWork(item, listing, connection, action);
        if (!queued) continue;
        message = queued;
      }
      await db.insert(syncEvents).values({ organizationId, itemId, connectionId: connection.id, action, ok, message });
      outcomes.push({ store, action, ok, message });
      continue;
    }
    try {
      const adapter = adapterFor(connection.marketplace);
      if (connection.status !== "active") throw new Error(`Reconnect your ${store} store first.`);
      if (action === "publish") {
        const storeItem = forStore(item, listing);
        const problems = adapter.validate(storeItem, listing, connection);
        if (problems.length) throw new Error(problems.join(" "));
        const result = await adapter.upsertListing(storeItem, listing, connection, {
          onCreated: async (remoteListingId) => {
            await db.update(channelListings).set({ remoteListingId }).where(eq(channelListings.id, listing.id));
          },
        });
        await db
          .update(channelListings)
          .set({
            status: "listed",
            remoteListingId: result.remoteListingId,
            remoteOfferId: result.remoteOfferId ?? listing.remoteOfferId,
            listedAt: result.remoteListingId !== listing.remoteListingId || listing.status !== "listed" ? new Date() : listing.listedAt,
            lastSyncedAt: new Date(),
            lastError: null,
          })
          .where(eq(channelListings.id, listing.id));
        message = `${store}: listed (listing ${result.remoteListingId})`;
      } else {
        await adapter.endListing(listing, connection);
        await db
          .update(channelListings)
          .set({ status: "ended", lastSyncedAt: new Date(), lastError: null })
          .where(eq(channelListings.id, listing.id));
        message = `${store}: listing ended`;
      }
    } catch (err) {
      ok = false;
      const error = err instanceof Error ? err.message : String(err);
      message = `${store}: ${error}`;
      await db
        .update(channelListings)
        .set({ status: "error", lastError: error, lastSyncedAt: new Date() })
        .where(eq(channelListings.id, listing.id));
    }

    await db.insert(syncEvents).values({
      organizationId,
      itemId,
      connectionId: connection.id,
      action,
      ok,
      message,
    });
    outcomes.push({ store, action, ok, message });
  }
  return outcomes;
}
