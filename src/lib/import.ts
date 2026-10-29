import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { channelListings, itemImages, items, syncEvents, type Connection } from "@/db/schema";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces";
import { fetchActiveEbayListings, fromTradingItem } from "@/lib/marketplaces/ebay/trading";
import { fetchActiveEtsyListings, fromEtsyListing } from "@/lib/marketplaces/etsy/listings";
import type { ImportedListing } from "@/lib/marketplaces/imported";

export type ImportCounts = {
  // New items made from store listings.
  created: number;
  // Listings matched to an item already in Relistic (same SKU or same title).
  matched: number;
  // Imported before, so left alone.
  already: number;
  // Listings Relistic can't manage yet, like ones with variations.
  unsupported: number;
  // Not imported because the plan's active listing limit was reached.
  overLimit: number;
};

export const emptyCounts = (): ImportCounts => ({ created: 0, matched: 0, already: 0, unsupported: 0, overLimit: 0 });

export const IMPORTABLE = ["ebay", "etsy"] as const;
export type ImportableMarketplace = (typeof IMPORTABLE)[number];
export const isImportable = (m: string): m is ImportableMarketplace => (IMPORTABLE as readonly string[]).includes(m);

const SKU_PREFIX: Record<ImportableMarketplace, string> = { ebay: "EBAY", etsy: "ETSY" };

const sameTitle = (title: string) => sql`lower(btrim(${items.title})) = ${title.trim().toLowerCase()}`;

// An item in this account the listing belongs to: the same SKU, or else the same title,
// as long as that item isn't already linked to a different listing on this store.
async function findMatch(connection: Connection, l: ImportedListing) {
  const candidates = await db.query.items.findMany({
    where: and(
      eq(items.organizationId, connection.organizationId),
      l.sku ? sql`(${items.sku} = ${l.sku} or ${sameTitle(l.title)})` : sameTitle(l.title),
    ),
    with: { listings: { where: eq(channelListings.connectionId, connection.id) } },
    orderBy: [sql`${items.sku} = ${l.sku ?? ""} desc`, items.createdAt],
    limit: 5,
  });
  return candidates.find((c) => !c.listings.some((x) => x.remoteListingId && x.remoteListingId !== l.remoteListingId));
}

async function skuFor(organizationId: string, marketplace: ImportableMarketplace, l: ImportedListing) {
  const taken = async (sku: string) =>
    Boolean(await db.query.items.findFirst({ where: and(eq(items.organizationId, organizationId), eq(items.sku, sku)), columns: { id: true } }));
  if (l.sku && !(await taken(l.sku))) return l.sku;
  const base = `${SKU_PREFIX[marketplace]}-${l.remoteListingId}`;
  for (let n = 1; ; n++) {
    const sku = n === 1 ? base : `${base}-${n}`;
    if (!(await taken(sku))) return sku;
  }
}

// Bring a page of a store's live listings into Relistic. `room` is how many more active
// items the plan allows (null for no limit). Running it twice changes nothing.
export async function importListings(
  connection: Connection,
  listings: (ImportedListing | null)[],
  room: number | null,
): Promise<ImportCounts> {
  const marketplace = connection.marketplace as ImportableMarketplace;
  const counts = emptyCounts();
  for (const l of listings) {
    if (!l) {
      counts.unsupported++;
      continue;
    }
    const existing = await db.query.channelListings.findFirst({
      where: and(eq(channelListings.connectionId, connection.id), eq(channelListings.remoteListingId, l.remoteListingId)),
      columns: { id: true },
    });
    if (existing) {
      counts.already++;
      continue;
    }

    const linked = {
      enabled: true,
      status: "listed" as const,
      remoteListingId: l.remoteListingId,
      remoteOfferId: null,
      lastSyncedAt: new Date(),
      lastError: null,
    };

    const match = await findMatch(connection, l);
    if (match) {
      const activating = match.status !== "active" && match.status !== "sold_out";
      if (activating && room !== null && room <= 0) {
        counts.overLimit++;
        continue;
      }
      const old = match.listings[0]?.overrides ?? {};
      // Keep the store's own price if it differs, so the next save doesn't change it.
      const overrides = { ...old, ...l.overrides, ...(l.priceCents !== match.priceCents && { priceCents: l.priceCents }) };
      await db.transaction(async (tx) => {
        await tx
          .insert(channelListings)
          .values({ itemId: match.id, connectionId: connection.id, overrides, ...linked })
          .onConflictDoUpdate({ target: [channelListings.itemId, channelListings.connectionId], set: { overrides, ...linked } });
        // A draft or archived item with a live listing would be taken down on its next save.
        if (activating) await tx.update(items).set({ status: "active" }).where(eq(items.id, match.id));
      });
      if (activating && room !== null) room--;
      counts.matched++;
      continue;
    }

    const status = l.quantity > 0 ? "active" : "sold_out";
    if (status === "active" && room !== null && room <= 0) {
      counts.overLimit++;
      continue;
    }
    const sku = await skuFor(connection.organizationId, marketplace, l);
    await db.transaction(async (tx) => {
      const [item] = await tx
        .insert(items)
        .values({
          organizationId: connection.organizationId,
          sku,
          title: l.title,
          description: l.description,
          priceCents: l.priceCents,
          currency: l.currency,
          quantity: l.quantity,
          ...(l.condition && { condition: l.condition }),
          brand: l.brand ?? null,
          attributes: l.attributes ?? {},
          status,
        })
        .returning({ id: items.id });
      if (l.photos.length) {
        await tx.insert(itemImages).values(l.photos.map((url, position) => ({ itemId: item.id, url, position })));
      }
      await tx.insert(channelListings).values({ itemId: item.id, connectionId: connection.id, overrides: l.overrides, ...linked });
    });
    if (status === "active" && room !== null) room--;
    counts.created++;
  }
  return counts;
}

// Fetch one page of a store's live listings and import it. Pages start at 1.
export async function importPage(connection: Connection, page: number, room: number | null) {
  const marketplace = connection.marketplace;
  if (!isImportable(marketplace)) throw new Error("This store can't be imported yet.");
  const fetched =
    marketplace === "ebay"
      ? await fetchActiveEbayListings(connection, page).then((r) => ({ ...r, listings: r.items.map(fromTradingItem) }))
      : await fetchActiveEtsyListings(connection, page).then((r) => ({ ...r, listings: r.items.map(fromEtsyListing) }));
  const counts = await importListings(connection, fetched.listings, room);

  if (counts.created || counts.matched) {
    const store = MARKETPLACE_LABELS[marketplace];
    await db.insert(syncEvents).values({
      organizationId: connection.organizationId,
      connectionId: connection.id,
      action: "import",
      ok: true,
      message: [
        counts.created && `Imported ${counts.created} new item${counts.created === 1 ? "" : "s"} from ${store}.`,
        counts.matched && `Linked ${counts.matched} ${store} listing${counts.matched === 1 ? "" : "s"} to items you already had.`,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  return { counts, total: fetched.total, done: fetched.done };
}

// How many of this store's listings are already in Relistic.
export async function importedCount(connectionId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(channelListings)
    .where(and(eq(channelListings.connectionId, connectionId), isNotNull(channelListings.remoteListingId)));
  return row.n;
}
