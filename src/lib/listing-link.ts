import type { ChannelListing, Connection } from "@/db/schema";

// Where a listing can be seen on its store, when Relistic knows.
export function listingLink(
  listing: Pick<ChannelListing, "remoteUrl" | "remoteListingId" | "status">,
  store: Pick<Connection, "marketplace" | "environment" | "settings">,
  { includeEnded = false } = {},
): string | null {
  if (listing.remoteUrl) return listing.remoteUrl;
  const id = listing.remoteListingId;
  if (!id || (listing.status === "ended" && !includeEnded)) return null;
  if (store.marketplace === "ebay") return `https://www.${store.environment === "sandbox" ? "sandbox." : ""}ebay.com/itm/${id}`;
  if (store.marketplace === "etsy") return `https://www.etsy.com/listing/${id}`;
  if (store.marketplace === "shopify" && store.settings.shopDomain) {
    return `https://${store.settings.shopDomain}/admin/products/${id.split("/").pop()}`;
  }
  return null;
}
