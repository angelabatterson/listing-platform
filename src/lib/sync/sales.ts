import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { channelListings, connections, items, sales, syncEvents, type Connection } from "@/db/schema";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces";
import { fetchEbaySales } from "@/lib/marketplaces/ebay/orders";
import { fetchEtsySales } from "@/lib/marketplaces/etsy/orders";
import type { SaleLine } from "@/lib/marketplaces/orders";
import { syncItem } from "./run";

// Find which inventory item a sold line belongs to: by the store's listing id first,
// then by SKU.
async function matchItem(connection: Connection, line: SaleLine): Promise<string | null> {
  if (line.remoteListingId) {
    const listing = await db.query.channelListings.findFirst({
      where: and(
        eq(channelListings.connectionId, connection.id),
        eq(channelListings.remoteListingId, line.remoteListingId),
      ),
      columns: { itemId: true },
    });
    if (listing) return listing.itemId;
  }
  if (line.sku) {
    const item = await db.query.items.findFirst({
      where: and(eq(items.organizationId, connection.organizationId), eq(items.sku, line.sku)),
      columns: { id: true },
    });
    if (item) return item.id;
  }
  return null;
}

// Record sold lines from one store, lower the master quantity, and push the change to
// every other store. Safe to call twice with the same lines: each line counts once.
export async function recordSales(connection: Connection, lines: SaleLine[]): Promise<number> {
  const store = MARKETPLACE_LABELS[connection.marketplace];
  let recorded = 0;
  for (const line of lines) {
    const itemId = await matchItem(connection, line);
    const [sale] = await db
      .insert(sales)
      .values({
        organizationId: connection.organizationId,
        connectionId: connection.id,
        itemId,
        externalOrderId: line.orderId,
        externalLineId: line.lineId,
        sku: line.sku,
        quantity: line.quantity,
        soldAt: line.soldAt,
      })
      .onConflictDoNothing()
      .returning({ id: sales.id });
    if (!sale || !itemId) continue; // Already handled, or not an item we manage.
    recorded++;

    const { before, after } = await db.transaction(async (tx) => {
      const [row] = await tx.select({ quantity: items.quantity }).from(items).where(eq(items.id, itemId)).for("update");
      const [updated] = await tx
        .update(items)
        .set({ quantity: sql`greatest(${items.quantity} - ${line.quantity}, 0)` })
        .where(eq(items.id, itemId))
        .returning({ quantity: items.quantity });
      return { before: row, after: updated };
    });

    const oversold = before.quantity < line.quantity;
    await db.insert(syncEvents).values({
      organizationId: connection.organizationId,
      itemId,
      connectionId: connection.id,
      action: "sale",
      ok: !oversold,
      message: oversold
        ? `Sold ${line.quantity} on ${store}, but only ${before.quantity} was in stock. Check for an oversell.`
        : `Sold ${line.quantity} on ${store}. ${after.quantity} left.`,
    });
    await syncItem(connection.organizationId, itemId, { soldOn: connection.id });
  }
  return recorded;
}

const fetchers: Record<Connection["marketplace"], (c: Connection, since: Date) => Promise<SaleLine[]>> = {
  ebay: fetchEbaySales,
  etsy: fetchEtsySales,
};

// Overlap each check a little so an order that arrives late isn't missed;
// recordSales ignores lines it has already seen.
const OVERLAP_MS = 15 * 60 * 1000;

export async function checkAllStoresForSales() {
  const active = await db.query.connections.findMany({ where: eq(connections.status, "active") });
  const results: { connectionId: string; recorded?: number; error?: string }[] = [];
  for (const connection of active) {
    const checkedAt = new Date();
    const since = new Date((connection.ordersCheckedAt ?? connection.createdAt).getTime() - OVERLAP_MS);
    try {
      const lines = await fetchers[connection.marketplace](connection, since);
      const recorded = await recordSales(connection, lines);
      await db.update(connections).set({ ordersCheckedAt: checkedAt }).where(eq(connections.id, connection.id));
      results.push({ connectionId: connection.id, recorded });
    } catch (err) {
      results.push({ connectionId: connection.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
