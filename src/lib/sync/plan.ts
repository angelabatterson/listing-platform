import type { ChannelListing, Item } from "@/db/schema";

export type ChannelAction = "publish" | "end" | "none";

// Decide what a store's listing should do so it matches the master item.
// "publish" creates the listing or updates the live one.
export function planChannelAction(
  item: Pick<Item, "status" | "quantity">,
  listing: Pick<ChannelListing, "enabled" | "status" | "remoteListingId">,
): ChannelAction {
  const shouldBeLive = listing.enabled && item.status === "active" && item.quantity > 0;
  if (shouldBeLive) return "publish";
  // A listing that errored after going live may still be up, so end it too.
  if (listing.remoteListingId && listing.status !== "ended") return "end";
  return "none";
}
