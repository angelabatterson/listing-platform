import type { ChannelListing, Connection, Item, ItemImage } from "@/db/schema";

export type ItemWithImages = Item & { images: ItemImage[] };

export type UpsertResult = {
  remoteListingId: string;
  remoteOfferId?: string;
};

// What every marketplace integration implements. eBay is first; Etsy plugs in here next.
export interface MarketplaceAdapter {
  // Problems that would make the marketplace reject the listing, in plain language.
  validate(item: ItemWithImages, listing: ChannelListing, connection: Connection): string[];
  // Create the listing if it doesn't exist, otherwise update it to match the item.
  upsertListing(item: ItemWithImages, listing: ChannelListing, connection: Connection): Promise<UpsertResult>;
  // Take the listing down without deleting the item.
  endListing(listing: ChannelListing, connection: Connection): Promise<void>;
}
