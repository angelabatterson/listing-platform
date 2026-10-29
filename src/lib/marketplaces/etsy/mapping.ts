import type { ChannelListing, EtsyConnectionSettings } from "@/db/schema";
import { isSafePublicUrl } from "@/lib/safe-url";
import { formatPrice } from "../ebay/mapping";
import type { ItemWithImages } from "../types";

export const ETSY_TITLE_MAX = 140;

function listingPrice(item: ItemWithImages, listing: ChannelListing): number {
  return Number(formatPrice(listing.overrides.priceCents ?? item.priceCents));
}

export function validateForEtsy(
  item: ItemWithImages,
  listing: ChannelListing,
  settings: EtsyConnectionSettings,
): string[] {
  const problems: string[] = [];
  if (!/^\d+$/.test(listing.overrides.categoryId ?? "")) problems.push("Choose an Etsy category for this item.");
  if (!listing.overrides.whenMade) problems.push("Choose when the item was made for Etsy.");
  if (item.images.length === 0) problems.push("Add at least one photo.");
  if (item.images.some((i) => !isSafePublicUrl(i.url))) problems.push("Photo links must be public https:// links.");
  if (!settings.shopId) problems.push("Reconnect your Etsy shop.");
  if (!settings.shippingProfileId || !settings.returnPolicyId || !settings.readinessStateId) {
    problems.push("Pick your Etsy shipping profile, return policy and processing profile on the Stores page.");
  }
  if (listingPrice(item, listing) <= 0) problems.push("Set a price above zero.");
  return problems;
}

// The listing details shared by createDraftListing and updateListing (form-encoded).
// Shipping and returns are only set when the listing is created, so updating a listing
// imported from Etsy keeps the profiles the seller chose there.
export function toListingFields(item: ItemWithImages, listing: ChannelListing, settings: EtsyConnectionSettings) {
  return {
    title: (listing.overrides.title || item.title).slice(0, ETSY_TITLE_MAX),
    description: item.description || item.title,
    who_made: settings.whoMade ?? "someone_else",
    when_made: listing.overrides.whenMade,
    taxonomy_id: listing.overrides.categoryId,
    type: "physical",
  };
}

export function toDraftListing(item: ItemWithImages, listing: ChannelListing, settings: EtsyConnectionSettings) {
  return {
    ...toListingFields(item, listing, settings),
    shipping_profile_id: settings.shippingProfileId,
    return_policy_id: settings.returnPolicyId,
    quantity: item.quantity,
    price: listingPrice(item, listing),
    readiness_state_id: settings.readinessStateId,
  };
}

// Body for PUT /v3/application/listings/{listing_id}/inventory. A single product
// with no variations; Etsy replaces the whole product set on every call.
export function toInventory(item: ItemWithImages, listing: ChannelListing, settings: EtsyConnectionSettings) {
  return {
    products: [
      {
        sku: item.sku,
        property_values: [],
        offerings: [
          {
            price: listingPrice(item, listing),
            quantity: item.quantity,
            is_enabled: true,
            readiness_state_id: settings.readinessStateId ? Number(settings.readinessStateId) : null,
          },
        ],
      },
    ],
    price_on_property: [],
    quantity_on_property: [],
    sku_on_property: [],
    readiness_state_on_property: [],
  };
}
