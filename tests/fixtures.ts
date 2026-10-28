import type { ChannelListing, Connection } from "@/db/schema";
import type { ItemWithImages } from "@/lib/marketplaces/types";
import { encrypt } from "@/lib/crypto";

export function makeItem(overrides: Partial<ItemWithImages> = {}): ItemWithImages {
  return {
    id: "item-1",
    organizationId: "org-1",
    sku: "JACKET-001",
    title: "Vintage denim jacket",
    description: "Lightly worn, size M.",
    priceCents: 4550,
    currency: "USD",
    quantity: 1,
    condition: "USED_GOOD",
    brand: "Levi's",
    attributes: { Size: ["M"] },
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    images: [
      { id: "img-2", itemId: "item-1", url: "https://img.example/2.jpg", position: 1 },
      { id: "img-1", itemId: "item-1", url: "https://img.example/1.jpg", position: 0 },
    ],
    ...overrides,
  };
}

export function makeListing(overrides: Partial<ChannelListing> = {}): ChannelListing {
  return {
    id: "listing-1",
    itemId: "item-1",
    connectionId: "conn-1",
    enabled: true,
    overrides: { categoryId: "57988" },
    remoteListingId: null,
    remoteOfferId: null,
    status: "not_listed",
    lastSyncedAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-1",
    organizationId: "org-1",
    marketplace: "ebay",
    environment: "sandbox",
    externalAccountId: null,
    displayName: null,
    accessTokenEnc: encrypt("access-token"),
    accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    refreshTokenEnc: encrypt("refresh-token"),
    refreshTokenExpiresAt: null,
    settings: {
      marketplaceId: "EBAY_US",
      merchantLocationKey: "default",
      fulfillmentPolicyId: "f1",
      paymentPolicyId: "p1",
      returnPolicyId: "r1",
    },
    status: "active",
    ordersCheckedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
