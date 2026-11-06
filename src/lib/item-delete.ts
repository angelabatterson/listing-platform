import type { ChannelListing, Connection, Item } from "@/db/schema";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces/labels";

// Deleting an item from Inventory. Sold items are kept for the sales records, and an
// item is only deleted once it's off every store, so nothing is left live with no
// item behind it.

type Listing = Pick<ChannelListing, "status" | "remoteListingId" | "remoteUrl"> & {
  connection: Pick<Connection, "marketplace">;
};

export const SOLD_MESSAGE = "It has sold, so it stays in Relistic for your sales records. Archive it instead to hide it.";

export function hasSold(item: Pick<Item, "status">, saleCount: number): boolean {
  return item.status === "sold_out" || saleCount > 0;
}

// Up (or possibly up) on the store: listed, or posted once and not ended since.
export function stillUp(listing: Pick<ChannelListing, "status" | "remoteListingId" | "remoteUrl">): boolean {
  if (listing.status === "listed") return true;
  if (listing.status === "ended" || listing.status === "not_listed") return false;
  return Boolean(listing.remoteListingId || listing.remoteUrl);
}

// The stores the item is still up on, by name, each once.
export function storesStillUp(listings: Listing[]): string[] {
  return [...new Set(listings.filter(stillUp).map((l) => MARKETPLACE_LABELS[l.connection.marketplace]))];
}

export function stillUpMessage(stores: string[]): string {
  const list = stores.length > 1 ? `${stores.slice(0, -1).join(", ")} and ${stores.at(-1)}` : stores[0];
  return `It's still up on ${list}. Take it down there first (Delist), then delete it.`;
}
