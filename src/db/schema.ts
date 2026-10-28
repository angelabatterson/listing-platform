import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const marketplaceEnum = pgEnum("marketplace", ["ebay", "etsy"]);

export const connectionStatusEnum = pgEnum("connection_status", [
  "active",
  "needs_reauth",
  "disconnected",
]);

export const itemStatusEnum = pgEnum("item_status", [
  "draft",
  "active",
  "sold_out",
  "archived",
]);

export const listingStatusEnum = pgEnum("listing_status", [
  "not_listed",
  "listed",
  "ended",
  "error",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

// A client account. Every row below belongs to exactly one organization.
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ...timestamps,
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  ...timestamps,
});

// Only a SHA-256 of the session token is stored, so a database leak can't be replayed.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type EbayConnectionSettings = {
  marketplaceId?: string;
  merchantLocationKey?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  postalCode?: string;
  country?: string;
};

// A marketplace store connected through OAuth. Tokens are encrypted (see lib/crypto).
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    marketplace: marketplaceEnum("marketplace").notNull(),
    environment: text("environment").notNull(),
    externalAccountId: text("external_account_id"),
    displayName: text("display_name"),
    accessTokenEnc: text("access_token_enc").notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    settings: jsonb("settings").$type<EbayConnectionSettings>().default({}).notNull(),
    status: connectionStatusEnum("status").default("active").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("connections_org_marketplace").on(t.organizationId, t.marketplace)],
);

export type ItemAttributes = Record<string, string[]>;

// The master record for one thing a client is selling.
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    quantity: integer("quantity").notNull().default(1),
    condition: text("condition").notNull().default("USED_GOOD"),
    brand: text("brand"),
    attributes: jsonb("attributes").$type<ItemAttributes>().default({}).notNull(),
    status: itemStatusEnum("status").default("draft").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("items_org_sku").on(t.organizationId, t.sku)],
);

export const itemImages = pgTable("item_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  position: integer("position").notNull().default(0),
});

export type ListingOverrides = {
  title?: string;
  priceCents?: number;
  categoryId?: string;
};

// One row per (item, store). `enabled` is the "list it here" checkbox.
export const channelListings = pgTable(
  "channel_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    overrides: jsonb("overrides").$type<ListingOverrides>().default({}).notNull(),
    remoteListingId: text("remote_listing_id"),
    remoteOfferId: text("remote_offer_id"),
    status: listingStatusEnum("status").default("not_listed").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [uniqueIndex("channel_listings_item_connection").on(t.itemId, t.connectionId)],
);

// The activity log: every sync action and its result.
export const syncEvents = pgTable("sync_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
  connectionId: uuid("connection_id").references(() => connections.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  ok: boolean("ok").notNull(),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const itemsRelations = relations(items, ({ many }) => ({
  images: many(itemImages),
  listings: many(channelListings),
}));

export const itemImagesRelations = relations(itemImages, ({ one }) => ({
  item: one(items, { fields: [itemImages.itemId], references: [items.id] }),
}));

export const channelListingsRelations = relations(channelListings, ({ one }) => ({
  item: one(items, { fields: [channelListings.itemId], references: [items.id] }),
  connection: one(connections, {
    fields: [channelListings.connectionId],
    references: [connections.id],
  }),
}));

export type Item = typeof items.$inferSelect;
export type ItemImage = typeof itemImages.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type ChannelListing = typeof channelListings.$inferSelect;
