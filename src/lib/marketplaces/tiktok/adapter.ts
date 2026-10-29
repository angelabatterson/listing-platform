import type { ChannelListing, Connection } from "@/db/schema";
import { isSafePublicUrl } from "@/lib/safe-url";
import type { ItemWithImages, MarketplaceAdapter, UpsertHooks } from "../types";
import { tiktokFetch } from "./client";
import { TIKTOK_VERSION } from "./config";
import { inventory, listingTitle, price, TIKTOK_MAX_PHOTOS, toProduct, validateForTiktok } from "./mapping";
import { toDescriptionHtml } from "../shopify/mapping";

const product = `/product/${TIKTOK_VERSION}`;

// TikTok only takes photos it hosts, so each one is downloaded and uploaded.
async function uploadImages(connection: Connection, item: ItemWithImages): Promise<string[]> {
  const images = [...item.images].sort((a, b) => a.position - b.position).slice(0, TIKTOK_MAX_PHOTOS);
  const uris: string[] = [];
  for (const [i, image] of images.entries()) {
    if (!isSafePublicUrl(image.url)) throw new Error(`Photo ${i + 1} isn't a public https:// link.`);
    const res = await fetch(image.url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Couldn't download photo ${i + 1} (${res.status}).`);
    const form = new FormData();
    form.set("data", await res.blob(), `photo-${i + 1}.jpg`);
    form.set("use_case", "MAIN_IMAGE");
    const uploaded = await tiktokFetch<{ uri: string }>(connection, `${product}/images/upload`, { multipart: form });
    uris.push(uploaded.uri);
  }
  return uris;
}

// The seller's category if they chose one, otherwise TikTok's suggestion for the title.
async function categoryFor(connection: Connection, item: ItemWithImages, listing: ChannelListing): Promise<string> {
  if (listing.overrides.categoryId) return listing.overrides.categoryId;
  const suggested = await tiktokFetch<{ leaf_category_id?: string }>(connection, `${product}/categories/recommend`, {
    json: { product_title: listingTitle(item, listing) },
  });
  if (!suggested.leaf_category_id) {
    throw new Error("TikTok Shop couldn't suggest a category. Enter a TikTok Shop category ID on the item.");
  }
  return suggested.leaf_category_id;
}

export const tiktokAdapter: MarketplaceAdapter = {
  validate(item, listing, connection) {
    return validateForTiktok(item, listing, connection.settings);
  },

  // remoteListingId is the product id and remoteOfferId its one SKU's id.
  async upsertListing(item: ItemWithImages, listing: ChannelListing, connection: Connection, hooks?: UpsertHooks) {
    const settings = connection.settings;
    let productId = listing.remoteListingId;
    let skuId = listing.remoteOfferId;

    if (!productId) {
      const [categoryId, imageUris] = await Promise.all([
        categoryFor(connection, item, listing),
        uploadImages(connection, item),
      ]);
      const created = await tiktokFetch<{ product_id: string; skus?: { id: string }[] }>(connection, `${product}/products`, {
        json: toProduct(item, listing, settings, categoryId, imageUris),
      });
      productId = created.product_id;
      skuId = created.skus?.[0]?.id ?? null;
      await hooks?.onCreated?.(productId);
      return { remoteListingId: productId, ...(skuId && { remoteOfferId: skuId }) };
    }

    // Changing only the words, price and stock keeps the product live; a full edit
    // would send it back through TikTok's review.
    if (!skuId) {
      const found = await tiktokFetch<{ skus?: { id: string }[] }>(connection, `${product}/products/${productId}`);
      skuId = found.skus?.[0]?.id ?? null;
      if (!skuId) throw new Error("TikTok Shop didn't return this product's SKU.");
    }
    await tiktokFetch(connection, `${product}/products/${productId}/partial_edit`, {
      json: { title: listingTitle(item, listing), description: toDescriptionHtml(item) },
    });
    await tiktokFetch(connection, `${product}/products/${productId}/prices/update`, {
      json: { skus: [{ id: skuId, price: price(item, listing) }] },
    });
    await tiktokFetch(connection, `${product}/products/${productId}/inventory/update`, {
      json: { skus: [{ id: skuId, inventory: inventory(item, settings) }] },
    });
    if (listing.status === "ended") {
      await tiktokFetch(connection, `${product}/products/activate`, { json: { product_ids: [productId] } });
    }
    return { remoteListingId: productId, remoteOfferId: skuId };
  },

  // A deactivated product is hidden from buyers but kept, so it can come back.
  async endListing(listing: ChannelListing, connection: Connection) {
    if (!listing.remoteListingId) return;
    await tiktokFetch(connection, `${product}/products/deactivate`, { json: { product_ids: [listing.remoteListingId] } });
  },
};

// The shops this seller authorized (the first is used) and its default warehouse.
export async function fetchTiktokShop(connection: Connection) {
  const { shops } = await tiktokFetch<{ shops?: { id: string; name: string; cipher: string; region?: string }[] }>(
    connection,
    `/authorization/${TIKTOK_VERSION}/shops`,
    { withShop: false },
  );
  const shop = shops?.[0];
  if (!shop) throw new Error("This TikTok account has no shop.");
  const withShop = { ...connection, settings: { ...connection.settings, shopCipher: shop.cipher } };
  const { warehouses } = await tiktokFetch<{
    warehouses?: { id: string; type?: string; effect_status?: string; is_default?: boolean }[];
  }>(withShop, `/logistics/${TIKTOK_VERSION}/warehouses`);
  const selling = (warehouses ?? []).filter((w) => w.type !== "RETURN_WAREHOUSE" && w.effect_status !== "DISABLED");
  const warehouse = selling.find((w) => w.is_default) ?? selling[0];
  if (!warehouse) throw new Error("This TikTok Shop has no warehouse to ship from.");
  return { tiktokShopId: shop.id, shopName: shop.name, shopCipher: shop.cipher, warehouseId: warehouse.id };
}
