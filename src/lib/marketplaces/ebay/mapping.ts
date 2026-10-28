import type { ChannelListing, EbayConnectionSettings } from "@/db/schema";
import type { ItemWithImages } from "../types";
import { DEFAULT_MARKETPLACE_ID } from "./config";

export const EBAY_TITLE_MAX = 80;

export const EBAY_CONDITIONS = [
  { value: "NEW", label: "New" },
  { value: "NEW_OTHER", label: "New, other (open box)" },
  { value: "NEW_WITH_DEFECTS", label: "New with defects" },
  { value: "USED_EXCELLENT", label: "Used, excellent" },
  { value: "USED_VERY_GOOD", label: "Used, very good" },
  { value: "USED_GOOD", label: "Used, good" },
  { value: "USED_ACCEPTABLE", label: "Used, acceptable" },
  { value: "FOR_PARTS_OR_NOT_WORKING", label: "For parts or not working" },
] as const;

export function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function listingTitle(item: ItemWithImages, listing: ChannelListing): string {
  return (listing.overrides.title || item.title).slice(0, EBAY_TITLE_MAX);
}

export function validateForEbay(
  item: ItemWithImages,
  listing: ChannelListing,
  settings: EbayConnectionSettings,
): string[] {
  const problems: string[] = [];
  if (!listing.overrides.categoryId) problems.push("Choose an eBay category for this item.");
  if (item.images.length === 0) problems.push("Add at least one photo.");
  if (item.images.some((i) => !i.url.startsWith("https://"))) problems.push("Photo links must start with https://.");
  if (!settings.merchantLocationKey) problems.push("Set your ship-from location on the Stores page.");
  if (!settings.fulfillmentPolicyId || !settings.paymentPolicyId || !settings.returnPolicyId) {
    problems.push("Pick your eBay shipping, payment and return policies on the Stores page.");
  }
  if ((listing.overrides.priceCents ?? item.priceCents) <= 0) problems.push("Set a price above zero.");
  return problems;
}

// Body for PUT /sell/inventory/v1/inventory_item/{sku}
export function toInventoryItem(item: ItemWithImages, listing: ChannelListing) {
  const aspects: Record<string, string[]> = { ...item.attributes };
  if (item.brand) aspects.Brand = [item.brand];
  return {
    availability: { shipToLocationAvailability: { quantity: item.quantity } },
    condition: item.condition,
    product: {
      title: listingTitle(item, listing),
      description: item.description || item.title,
      imageUrls: [...item.images].sort((a, b) => a.position - b.position).map((i) => i.url),
      aspects,
    },
  };
}

// Body for POST /sell/inventory/v1/offer and PUT /offer/{offerId}
export function toOffer(item: ItemWithImages, listing: ChannelListing, settings: EbayConnectionSettings) {
  return {
    sku: item.sku,
    marketplaceId: settings.marketplaceId ?? DEFAULT_MARKETPLACE_ID,
    format: "FIXED_PRICE",
    availableQuantity: item.quantity,
    categoryId: listing.overrides.categoryId,
    listingDescription: item.description || item.title,
    listingPolicies: {
      fulfillmentPolicyId: settings.fulfillmentPolicyId,
      paymentPolicyId: settings.paymentPolicyId,
      returnPolicyId: settings.returnPolicyId,
    },
    merchantLocationKey: settings.merchantLocationKey,
    pricingSummary: {
      price: {
        value: formatPrice(listing.overrides.priceCents ?? item.priceCents),
        currency: item.currency,
      },
    },
  };
}
