import type { ChannelListing, ShopifyConnectionSettings } from "@/db/schema";
import { isSafePublicUrl } from "@/lib/safe-url";
import { EBAY_CONDITIONS, formatPrice } from "../ebay/mapping";
import type { ItemWithImages } from "../types";

export const SHOPIFY_TITLE_MAX = 255;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Shopify descriptions are HTML; Relistic's are plain text with line breaks.
export function toDescriptionHtml(item: ItemWithImages): string {
  const condition = EBAY_CONDITIONS.find((c) => c.value === item.condition)?.label;
  const text = [item.description.trim() || item.title, condition && `Condition: ${condition}`].filter(Boolean).join("\n\n");
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function validateForShopify(
  item: ItemWithImages,
  listing: ChannelListing,
  settings: ShopifyConnectionSettings,
): string[] {
  const problems: string[] = [];
  if (item.images.some((i) => !isSafePublicUrl(i.url))) problems.push("Photo links must be public https:// links.");
  if (!settings.shopDomain || !settings.locationId) problems.push("Reconnect your Shopify store.");
  if ((listing.overrides.priceCents ?? item.priceCents) <= 0) problems.push("Set a price above zero.");
  return problems;
}

const OPTION = { name: "Title", value: "Default Title" };

// Input for productSet: one product with a single variant, stocked at the store's
// location. Photos are only sent when the product is created, so editing an item
// doesn't add them again.
export function toProductSet(
  item: ItemWithImages,
  listing: ChannelListing,
  settings: ShopifyConnectionSettings,
  existing: { variantId?: string | null; withPhotos: boolean },
) {
  const photos = [...item.images].sort((a, b) => a.position - b.position);
  return {
    title: (listing.overrides.title || item.title).slice(0, SHOPIFY_TITLE_MAX),
    descriptionHtml: toDescriptionHtml(item),
    ...(item.brand && { vendor: item.brand }),
    status: "ACTIVE",
    productOptions: [{ name: OPTION.name, values: [{ name: OPTION.value }] }],
    variants: [
      {
        ...(existing.variantId && { id: existing.variantId }),
        optionValues: [{ optionName: OPTION.name, name: OPTION.value }],
        price: formatPrice(listing.overrides.priceCents ?? item.priceCents),
        inventoryItem: { sku: item.sku, tracked: true },
        inventoryQuantities: [{ locationId: settings.locationId, name: "available", quantity: item.quantity }],
      },
    ],
    ...(existing.withPhotos &&
      photos.length > 0 && {
        files: photos.map((p, i) => ({ originalSource: p.url, contentType: "IMAGE", alt: `${item.title} photo ${i + 1}` })),
      }),
  };
}
