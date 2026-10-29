import type { ChannelListing, TiktokConnectionSettings } from "@/db/schema";
import { isSafePublicUrl } from "@/lib/safe-url";
import { formatPrice } from "../ebay/mapping";
import { toDescriptionHtml } from "../shopify/mapping";
import type { ItemWithImages } from "../types";
import { DEFAULT_PACKAGE_WEIGHT_LB } from "./config";

export const TIKTOK_TITLE_MAX = 255;
export const TIKTOK_MAX_PHOTOS = 9;

export function listingTitle(item: ItemWithImages, listing: ChannelListing): string {
  return (listing.overrides.title || item.title).slice(0, TIKTOK_TITLE_MAX);
}

export function validateForTiktok(
  item: ItemWithImages,
  listing: ChannelListing,
  settings: TiktokConnectionSettings,
): string[] {
  const problems: string[] = [];
  if (item.images.length === 0) problems.push("Add at least one photo.");
  if (item.images.some((i) => !isSafePublicUrl(i.url))) problems.push("Photo links must be public https:// links.");
  if (!settings.shopCipher || !settings.warehouseId) problems.push("Reconnect your TikTok Shop.");
  if ((listing.overrides.priceCents ?? item.priceCents) <= 0) problems.push("Set a price above zero.");
  if (listing.overrides.categoryId && !/^\d+$/.test(listing.overrides.categoryId)) {
    problems.push("The TikTok Shop category ID should be a number.");
  }
  return problems;
}

export const price = (item: ItemWithImages, listing: ChannelListing) => ({
  amount: formatPrice(listing.overrides.priceCents ?? item.priceCents),
  currency: item.currency || "USD",
});

export const inventory = (item: ItemWithImages, settings: TiktokConnectionSettings) => [
  { warehouse_id: settings.warehouseId, quantity: item.quantity },
];

// Body for creating a product: one SKU with no variations.
export function toProduct(
  item: ItemWithImages,
  listing: ChannelListing,
  settings: TiktokConnectionSettings,
  categoryId: string,
  imageUris: string[],
) {
  return {
    title: listingTitle(item, listing),
    description: toDescriptionHtml(item),
    category_id: categoryId,
    main_images: imageUris.map((uri) => ({ uri })),
    skus: [{ seller_sku: item.sku, price: price(item, listing), inventory: inventory(item, settings) }],
    package_weight: { value: String(settings.packageWeightLb ?? DEFAULT_PACKAGE_WEIGHT_LB), unit: "POUND" },
    is_cod_allowed: false,
  };
}
