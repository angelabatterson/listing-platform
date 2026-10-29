import type { ChannelListing, Connection } from "@/db/schema";
import type { ItemWithImages, MarketplaceAdapter } from "../types";
import { EbayApiError, ebayFetch } from "./client";
import { DEFAULT_MARKETPLACE_ID } from "./config";
import { isWebsiteListing, toInventoryItem, toOffer, validateForEbay } from "./mapping";
import { endEbayItem, relistEbayItem, reviseEbayPriceAndQuantity } from "./trading";

const OFFER_ALREADY_EXISTS = 25002;

const inventoryPath = "/sell/inventory/v1";

async function findOfferId(connection: Connection, sku: string, marketplaceId: string) {
  const res = await ebayFetch<{ offers?: { offerId: string }[] }>(
    connection,
    `${inventoryPath}/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${marketplaceId}`,
  );
  return res.offers?.[0]?.offerId;
}

export const ebayAdapter: MarketplaceAdapter = {
  validate(item, listing, connection) {
    return validateForEbay(item, listing, connection.settings);
  },

  async upsertListing(item: ItemWithImages, listing: ChannelListing, connection: Connection) {
    if (isWebsiteListing(listing)) {
      // An imported listing made on eBay's website: only its price and quantity follow Relistic.
      const itemId =
        listing.status === "ended" ? await relistEbayItem(connection, listing.remoteListingId!) : listing.remoteListingId!;
      await reviseEbayPriceAndQuantity(connection, itemId, listing.overrides.priceCents ?? item.priceCents, item.quantity);
      return { remoteListingId: itemId };
    }
    const settings = connection.settings;
    const marketplaceId = settings.marketplaceId ?? DEFAULT_MARKETPLACE_ID;
    const sku = encodeURIComponent(item.sku);

    await ebayFetch(connection, `${inventoryPath}/inventory_item/${sku}`, {
      method: "PUT",
      body: toInventoryItem(item, listing),
    });

    const offer = toOffer(item, listing, settings);
    let offerId = listing.remoteOfferId ?? undefined;
    if (offerId) {
      // Updating a published offer also updates the live listing.
      await ebayFetch(connection, `${inventoryPath}/offer/${offerId}`, { method: "PUT", body: offer });
    } else {
      try {
        const created = await ebayFetch<{ offerId: string }>(connection, `${inventoryPath}/offer`, {
          method: "POST",
          body: offer,
        });
        offerId = created.offerId;
      } catch (err) {
        if (!(err instanceof EbayApiError && err.hasErrorId(OFFER_ALREADY_EXISTS))) throw err;
        offerId = await findOfferId(connection, item.sku, marketplaceId);
        if (!offerId) throw err;
        await ebayFetch(connection, `${inventoryPath}/offer/${offerId}`, { method: "PUT", body: offer });
      }
    }

    if (listing.status === "listed" && listing.remoteListingId && listing.remoteOfferId === offerId) {
      return { remoteListingId: listing.remoteListingId, remoteOfferId: offerId };
    }
    const published = await ebayFetch<{ listingId: string }>(
      connection,
      `${inventoryPath}/offer/${offerId}/publish`,
      { method: "POST" },
    );
    return { remoteListingId: published.listingId, remoteOfferId: offerId };
  },

  async endListing(listing: ChannelListing, connection: Connection) {
    if (isWebsiteListing(listing)) return endEbayItem(connection, listing.remoteListingId!);
    if (!listing.remoteOfferId) return;
    await ebayFetch(connection, `${inventoryPath}/offer/${listing.remoteOfferId}/withdraw`, {
      method: "POST",
    });
  },
};

// ---- Store setup helpers used by the Stores page ----

export type EbayPolicy = { id: string; name: string };

export type EbayPolicies = {
  fulfillment: EbayPolicy[];
  payment: EbayPolicy[];
  return: EbayPolicy[];
};

export async function fetchEbayPolicies(connection: Connection): Promise<EbayPolicies> {
  const marketplaceId = connection.settings.marketplaceId ?? DEFAULT_MARKETPLACE_ID;
  const get = async (kind: "fulfillment" | "payment" | "return") => {
    const key = `${kind}Policies`;
    const res = await ebayFetch<Record<string, Record<string, string>[] | undefined>>(
      connection,
      `/sell/account/v1/${kind}_policy?marketplace_id=${marketplaceId}`,
    );
    return (res[key] ?? []).map((p) => ({ id: p[`${kind}PolicyId`], name: p.name }));
  };
  const [fulfillment, payment, returns] = await Promise.all([get("fulfillment"), get("payment"), get("return")]);
  return { fulfillment, payment, return: returns };
}

// Business policies are required by the Inventory API. Opting in is idempotent.
export async function optInToBusinessPolicies(connection: Connection) {
  try {
    await ebayFetch(connection, "/sell/account/v1/program/opt_in", {
      method: "POST",
      body: { programType: "SELLING_POLICY_MANAGEMENT" },
    });
  } catch (err) {
    // Already opted in, or the account can't opt in yet. The Stores page shows what's missing.
    if (!(err instanceof EbayApiError)) throw err;
  }
}

export async function ensureEbayLocation(
  connection: Connection,
  address: { postalCode: string; country: string },
): Promise<string> {
  const key = "default";
  const path = `/sell/inventory/v1/location/${key}`;
  const exists = await ebayFetch(connection, path).then(
    () => true,
    (err) => {
      if (err instanceof EbayApiError && err.status === 404) return false;
      throw err;
    },
  );
  if (exists) {
    await ebayFetch(connection, `${path}/update_location_details`, {
      method: "POST",
      body: { location: { address } },
    });
  } else {
    await ebayFetch(connection, path, {
      method: "POST",
      body: {
        location: { address },
        locationTypes: ["WAREHOUSE"],
        name: "Default ship-from location",
        merchantLocationStatus: "ENABLED",
      },
    });
  }
  return key;
}

export async function fetchEbayUser(connection: Connection) {
  return ebayFetch<{ userId: string; username: string }>(connection, "/commerce/identity/v1/user/", {
    host: "apiz",
  });
}
