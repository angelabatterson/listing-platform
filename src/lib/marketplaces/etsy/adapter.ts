import type { ChannelListing, Connection } from "@/db/schema";
import { isSafePublicUrl } from "@/lib/safe-url";
import type { ItemWithImages, MarketplaceAdapter, UpsertHooks } from "../types";
import { etsyFetch } from "./client";
import { toDraftListing, toInventory, toListingFields, validateForEtsy } from "./mapping";

const app = "/v3/application";

// Etsy only accepts image files, so each photo is downloaded and re-uploaded.
async function uploadImages(connection: Connection, shopId: string, listingId: string, item: ItemWithImages) {
  const images = [...item.images].sort((a, b) => a.position - b.position);
  for (const [i, image] of images.entries()) {
    if (!isSafePublicUrl(image.url)) throw new Error(`Photo ${i + 1} isn't a public https:// link.`);
    const res = await fetch(image.url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Couldn't download photo ${i + 1} (${res.status}).`);
    const form = new FormData();
    form.set("image", await res.blob(), `photo-${i + 1}.jpg`);
    form.set("rank", String(i + 1));
    await etsyFetch(connection, `${app}/shops/${shopId}/listings/${listingId}/images`, {
      method: "POST",
      body: { multipart: form },
    });
  }
}

export const etsyAdapter: MarketplaceAdapter = {
  validate(item, listing, connection) {
    return validateForEtsy(item, listing, connection.settings);
  },

  async upsertListing(item: ItemWithImages, listing: ChannelListing, connection: Connection, hooks?: UpsertHooks) {
    const settings = connection.settings;
    const shopId = settings.shopId!;
    let listingId = listing.remoteListingId;

    if (!listingId) {
      const draft = await etsyFetch<{ listing_id: number }>(connection, `${app}/shops/${shopId}/listings`, {
        method: "POST",
        body: { form: toDraftListing(item, listing, settings) },
      });
      listingId = String(draft.listing_id);
      await hooks?.onCreated?.(listingId);
      await uploadImages(connection, shopId, listingId, item);
    } else {
      await etsyFetch(connection, `${app}/shops/${shopId}/listings/${listingId}`, {
        method: "PATCH",
        body: { form: toListingFields(item, listing, settings) },
      });
      if (listing.status !== "listed") {
        // A previous attempt may have stopped before the photos went up.
        const existing = await etsyFetch<{ count: number }>(connection, `${app}/listings/${listingId}/images`);
        if (existing.count === 0) await uploadImages(connection, shopId, listingId, item);
      }
    }

    await etsyFetch(connection, `${app}/listings/${listingId}/inventory`, {
      method: "PUT",
      body: { json: toInventory(item, listing, settings) },
    });
    if (listing.status !== "listed") {
      await etsyFetch(connection, `${app}/shops/${shopId}/listings/${listingId}`, {
        method: "PATCH",
        body: { form: { state: "active" } },
      });
    }
    return { remoteListingId: listingId };
  },

  async endListing(listing: ChannelListing, connection: Connection) {
    if (!listing.remoteListingId) return;
    await etsyFetch(connection, `${app}/shops/${connection.settings.shopId}/listings/${listing.remoteListingId}`, {
      method: "PATCH",
      body: { form: { state: "inactive" } },
    });
  },
};

// ---- Store setup helpers used by the Stores page ----

export type EtsyOption = { id: string; name: string };

export type EtsyShopOptions = {
  shippingProfiles: EtsyOption[];
  returnPolicies: EtsyOption[];
  processingProfiles: EtsyOption[];
};

type Results<T> = { results?: T[] };

export async function fetchEtsyShopOptions(connection: Connection): Promise<EtsyShopOptions> {
  const shopId = connection.settings.shopId;
  const [shipping, returns, processing] = await Promise.all([
    etsyFetch<Results<{ shipping_profile_id: number; title: string | null }>>(
      connection,
      `${app}/shops/${shopId}/shipping-profiles`,
    ),
    etsyFetch<Results<{ return_policy_id: number; accepts_returns: boolean; return_deadline: number | null }>>(
      connection,
      `${app}/shops/${shopId}/policies/return`,
    ),
    etsyFetch<Results<{ readiness_state_id: number; processing_days_display_label?: string; readiness_state?: string }>>(
      connection,
      `${app}/shops/${shopId}/readiness-state-definitions`,
    ),
  ]);
  return {
    shippingProfiles: (shipping.results ?? []).map((p) => ({
      id: String(p.shipping_profile_id),
      name: p.title || `Shipping profile ${p.shipping_profile_id}`,
    })),
    returnPolicies: (returns.results ?? []).map((p) => ({
      id: String(p.return_policy_id),
      name: p.accepts_returns ? `Accepts returns within ${p.return_deadline ?? "?"} days` : "No returns",
    })),
    processingProfiles: (processing.results ?? []).map((p) => ({
      id: String(p.readiness_state_id),
      name: [p.readiness_state === "made_to_order" ? "Made to order" : "Ready to ship", p.processing_days_display_label]
        .filter(Boolean)
        .join(", "),
    })),
  };
}

export async function fetchEtsyShop(connection: Connection) {
  const me = await etsyFetch<{ user_id: number; shop_id?: number }>(connection, `${app}/users/me`);
  if (!me.shop_id) throw new Error("This Etsy account doesn't have a shop yet.");
  const shop = await etsyFetch<{ shop_id: number; shop_name: string }>(connection, `${app}/shops/${me.shop_id}`);
  return { shopId: String(shop.shop_id), shopName: shop.shop_name };
}
