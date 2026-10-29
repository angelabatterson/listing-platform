import type { ChannelListing, Connection } from "@/db/schema";
import type { ItemWithImages, MarketplaceAdapter, UpsertHooks } from "../types";
import { fromGid, shopifyGraphql, throwUserErrors, toGid } from "./client";
import { toProductSet, validateForShopify } from "./mapping";

type UserErrors = { userErrors: { field?: string[] | null; message: string }[] };

const PRODUCT_SET = `
mutation RelisticProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
  productSet(input: $input, identifier: $identifier, synchronous: true) {
    product { id variants(first: 1) { nodes { id } } }
    userErrors { field message }
  }
}`;

const PRODUCT_UPDATE = `
mutation RelisticProductUpdate($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id }
    userErrors { field message }
  }
}`;

export const shopifyAdapter: MarketplaceAdapter = {
  validate(item, listing, connection) {
    return validateForShopify(item, listing, connection.settings);
  },

  // remoteListingId is the product's number and remoteOfferId its one variant's.
  async upsertListing(item: ItemWithImages, listing: ChannelListing, connection: Connection, hooks?: UpsertHooks) {
    const productId = listing.remoteListingId;
    const input = toProductSet(item, listing, connection.settings, {
      variantId: productId && listing.remoteOfferId ? toGid("ProductVariant", listing.remoteOfferId) : null,
      withPhotos: !productId,
    });
    const data = await shopifyGraphql<{
      productSet: UserErrors & { product: { id: string; variants: { nodes: { id: string }[] } } | null };
    }>(connection, PRODUCT_SET, {
      input,
      ...(productId && { identifier: { id: toGid("Product", productId) } }),
    });
    throwUserErrors(data.productSet.userErrors);
    const product = data.productSet.product;
    if (!product) throw new Error("Shopify didn't return the product.");
    const remoteListingId = fromGid(product.id);
    if (!productId) await hooks?.onCreated?.(remoteListingId);
    const variant = product.variants.nodes[0]?.id;
    return { remoteListingId, ...(variant && { remoteOfferId: fromGid(variant) }) };
  },

  // A draft product is hidden from the shop but kept, so it can come back.
  async endListing(listing: ChannelListing, connection: Connection) {
    if (!listing.remoteListingId) return;
    const data = await shopifyGraphql<{ productUpdate: UserErrors }>(connection, PRODUCT_UPDATE, {
      product: { id: toGid("Product", listing.remoteListingId), status: "DRAFT" },
    });
    throwUserErrors(data.productUpdate.userErrors);
  },
};

// The shop's name and the location Relistic keeps stock at (its first active one).
export async function fetchShopifyShop(connection: Connection) {
  const data = await shopifyGraphql<{
    shop: { name: string; myshopifyDomain: string };
    locations: { nodes: { id: string; name: string }[] };
  }>(
    connection,
    `{ shop { name myshopifyDomain } locations(first: 1, query: "active:true") { nodes { id name } } }`,
  );
  const location = data.locations.nodes[0];
  if (!location) throw new Error("This Shopify store has no active location to keep stock at.");
  return { name: data.shop.name, shopDomain: data.shop.myshopifyDomain, locationId: location.id };
}
