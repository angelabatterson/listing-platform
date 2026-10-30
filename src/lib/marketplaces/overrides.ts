import type { ChannelListing, Connection } from "@/db/schema";
import type { ItemWithImages } from "./types";

// The item as one store should show it: the main item with that store's own title,
// description, condition, price and photo choice laid over it.
export function forStore(item: ItemWithImages, listing: Pick<ChannelListing, "overrides">): ItemWithImages {
  const o = listing.overrides;
  let images = item.images;
  if (o.imageUrls?.length) {
    // Photos the seller has since removed from the item drop out; if none are left, use them all.
    const chosen = o.imageUrls
      .map((url) => item.images.find((i) => i.url === url))
      .filter((i): i is ItemWithImages["images"][number] => Boolean(i))
      .map((i, position) => ({ ...i, position }));
    if (chosen.length) images = chosen;
  }
  return {
    ...item,
    title: o.title || item.title,
    description: o.description || item.description,
    condition: o.condition || item.condition,
    priceCents: o.priceCents ?? item.priceCents,
    images,
  };
}

// The longest title each store takes, shown as a counter while editing.
export const TITLE_LIMITS: Partial<Record<Connection["marketplace"], number>> = {
  ebay: 80,
  etsy: 140,
  shopify: 255,
  tiktok: 255,
  poshmark: 80,
  facebook: 100,
  mercari: 80,
};
