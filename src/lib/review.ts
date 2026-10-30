import type { ChannelListing, Connection } from "@/db/schema";
import { adapterFor, MARKETPLACE_LABELS } from "@/lib/marketplaces";
import { forStore } from "@/lib/marketplaces/overrides";
import type { ItemWithImages } from "@/lib/marketplaces/types";
import { isConnectionReady } from "@/lib/stores";

export type ItemForReview = ItemWithImages & { listings: (ChannelListing & { connection: Connection })[] };

// What stops a draft from being posted, in plain language. Checked without calling
// the marketplaces, so it's quick enough to run for a whole batch on every view.
export function postingProblems(item: ItemForReview): string[] {
  const enabled = item.listings.filter((l) => l.enabled);
  if (enabled.length === 0) return ["Tick at least one store on the item page."];
  if (item.quantity < 1) return ["Set the quantity to at least 1."];
  return enabled.flatMap(({ connection, ...listing }) => {
    const store = MARKETPLACE_LABELS[connection.marketplace];
    if (!isConnectionReady(connection)) return [`${store}: finish this store's setup on the Stores page.`];
    return adapterFor(connection.marketplace)
      .validate(forStore(item, listing), listing, connection)
      .map((p) => `${store}: ${p}`);
  });
}
