import type { ItemFormValues } from "@/components/item-form";
import type { ChannelListing, Item, ItemImage } from "@/db/schema";
import { formatPrice } from "@/lib/marketplaces/ebay/mapping";
import { formatSpecifics } from "@/lib/specifics";

// An item as the item form shows it.
export function itemFormValues(item: Item & { images: ItemImage[]; listings: ChannelListing[] }): ItemFormValues {
  return {
    title: item.title,
    sku: item.sku,
    description: item.description,
    price: formatPrice(item.priceCents),
    cost: item.costCents === null ? "" : formatPrice(item.costCents),
    quantity: item.quantity,
    condition: item.condition,
    brand: item.brand ?? "",
    tags: item.tags.join(", "),
    notes: item.notes,
    status: item.status === "active" ? "active" : "draft",
    imageUrls: [...item.images]
      .sort((a, b) => a.position - b.position)
      .map((i) => i.url)
      .join("\n"),
    specifics: formatSpecifics(item.attributes),
    categoryHint: item.draftNotes.categoryQuery,
    skuLocked: item.listings.some((l) => l.remoteOfferId || l.remoteListingId),
  };
}
