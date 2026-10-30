import type { Connection } from "@/db/schema";
import { ebayFetch } from "./client";
import { DEFAULT_MARKETPLACE_ID } from "./config";

// eBay's Negotiation API: offers to buyers who are watching a listing or have it in their cart.

const negotiationPath = "/sell/negotiation/v1";
const PAGE = 200;

function marketplaceHeader(connection: Connection) {
  return { "X-EBAY-C-MARKETPLACE-ID": connection.settings.marketplaceId ?? DEFAULT_MARKETPLACE_ID };
}

// Listings with interested buyers that can be sent an offer right now. eBay leaves out
// listings that were sent one recently.
export async function findListingsWithWatchers(connection: Connection, max = 1000): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ids.length < max; offset += PAGE) {
    const page = await ebayFetch<{ eligibleItems?: { listingId: string }[]; total?: number }>(
      connection,
      `${negotiationPath}/find_eligible_items?limit=${PAGE}&offset=${offset}`,
      { headers: marketplaceHeader(connection) },
    );
    const found = page?.eligibleItems ?? [];
    ids.push(...found.map((i) => i.listingId));
    if (found.length < PAGE || offset + PAGE >= (page?.total ?? 0)) break;
  }
  return ids.slice(0, max);
}

// eBay lets buyers accept for 2 days; counter-offers stay off so nothing waits on the seller.
export function watcherOfferBody(listingId: string, discountPct: number, message?: string) {
  return {
    allowCounterOffer: false,
    ...(message ? { message } : {}),
    offerDuration: { unit: "DAY", value: 2 },
    offeredItems: [{ listingId, quantity: 1, discountPercentage: String(discountPct) }],
  };
}

export async function sendOfferToWatchers(connection: Connection, listingId: string, discountPct: number, message?: string) {
  await ebayFetch(connection, `${negotiationPath}/send_offer_to_interested_buyers`, {
    method: "POST",
    headers: marketplaceHeader(connection),
    body: watcherOfferBody(listingId, discountPct, message),
  });
}
