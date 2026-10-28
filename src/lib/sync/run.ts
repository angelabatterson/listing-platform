import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channelListings, items, syncEvents } from "@/db/schema";
import { adapterFor, MARKETPLACE_LABELS } from "@/lib/marketplaces";
import { planChannelAction } from "./plan";

export type SyncOutcome = { store: string; action: string; ok: boolean; message?: string };

// Push one item's current state to every store it's connected to.
// Runs inline for now; step 3 moves it onto a background queue.
export async function syncItem(organizationId: string, itemId: string): Promise<SyncOutcome[]> {
  const item = await db.query.items.findFirst({
    where: and(eq(items.id, itemId), eq(items.organizationId, organizationId)),
    with: { images: true, listings: { with: { connection: true } } },
  });
  if (!item) throw new Error("Item not found");

  const outcomes: SyncOutcome[] = [];
  for (const { connection, ...listing } of item.listings) {
    const store = MARKETPLACE_LABELS[connection.marketplace];
    const action = planChannelAction(item, listing);
    if (action === "none") continue;

    let ok = true;
    let message: string | undefined;
    try {
      const adapter = adapterFor(connection.marketplace);
      if (connection.status !== "active") throw new Error(`Reconnect your ${store} store first.`);
      if (action === "publish") {
        const problems = adapter.validate(item, listing, connection);
        if (problems.length) throw new Error(problems.join(" "));
        const result = await adapter.upsertListing(item, listing, connection);
        await db
          .update(channelListings)
          .set({
            status: "listed",
            remoteListingId: result.remoteListingId,
            remoteOfferId: result.remoteOfferId ?? listing.remoteOfferId,
            lastSyncedAt: new Date(),
            lastError: null,
          })
          .where(eq(channelListings.id, listing.id));
        message = `Listed (listing ${result.remoteListingId})`;
      } else {
        await adapter.endListing(listing, connection);
        await db
          .update(channelListings)
          .set({ status: "ended", lastSyncedAt: new Date(), lastError: null })
          .where(eq(channelListings.id, listing.id));
        message = "Listing ended";
      }
    } catch (err) {
      ok = false;
      message = err instanceof Error ? err.message : String(err);
      await db
        .update(channelListings)
        .set({ status: "error", lastError: message, lastSyncedAt: new Date() })
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
