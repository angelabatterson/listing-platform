import { relations, sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// eBay, Etsy, Shopify and TikTok Shop are reached through their APIs; the others through the Relistic
// Chrome extension, working in the seller's own signed-in browser (see lib/extension).
export const marketplaceEnum = pgEnum("marketplace", ["ebay", "etsy", "poshmark", "depop", "facebook", "mercari", "whatnot", "grailed", "shopify", "tiktok"]);

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
  // Queued for the Chrome extension to post or take down.
  "waiting",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

// A client account. Every row below belongs to exactly one organization.
// The billing columns mirror the account's Stripe subscription (see lib/billing).
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true })
    .default(sql`now() + interval '14 days'`)
    .notNull(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Stripe's status ("active", "past_due", "canceled", ...); null before the first plan.
  subscriptionStatus: text("subscription_status"),
  plan: text("plan"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
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

// What Relistic does on its own for an eBay store (the Automations page).
// Best Offer prices are percentages of each listing's price; 0 means "don't".
export type EbayAutomations = {
  bestOffer?: { enabled: boolean; acceptPct: number; declinePct: number };
  watcherOffers?: { enabled: boolean; discountPct: number; message?: string; lastRunAt?: string };
  // Ends and relists listings that haven't sold after `afterDays`, lowering the price by
  // `dropPct` each time but never below `floorPct` of the item's price.
  relist?: { enabled: boolean; afterDays: number; dropPct: number; floorPct: number; perDay: number; lastRunAt?: string };
};

export type EbayConnectionSettings = {
  automations?: EbayAutomations;
  marketplaceId?: string;
  merchantLocationKey?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  postalCode?: string;
  country?: string;
};

export type EtsyWhoMade = "i_did" | "someone_else" | "collective";

// Etsy ids are kept as strings, like eBay's, and converted when sent.
export type EtsyConnectionSettings = {
  shopId?: string;
  shippingProfileId?: string;
  returnPolicyId?: string;
  readinessStateId?: string;
  whoMade?: EtsyWhoMade;
};

// The shop's *.myshopify.com address, and the location (a gid) stock is kept at.
export type ShopifyConnectionSettings = {
  shopDomain?: string;
  locationId?: string;
};

// TikTok Shop: the shop, the cipher its API calls name it by, the warehouse stock is
// kept at, and the seller's usual package weight (TikTok requires one on every product).
export type TiktokConnectionSettings = {
  tiktokShopId?: string;
  shopCipher?: string;
  warehouseId?: string;
  packageWeightLb?: number;
};

// Each marketplace reads only its own keys from a connection's settings.
export type ConnectionSettings = EbayConnectionSettings &
  EtsyConnectionSettings &
  ShopifyConnectionSettings &
  TiktokConnectionSettings;

// A marketplace store: connected through OAuth, with encrypted tokens (see lib/crypto),
// or, for the extension stores, added by the seller with no tokens at all.
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
    accessTokenEnc: text("access_token_enc"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenEnc: text("refresh_token_enc"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    settings: jsonb("settings").$type<ConnectionSettings>().default({}).notNull(),
    status: connectionStatusEnum("status").default("active").notNull(),
    // Orders created after this time haven't been checked for sales yet.
    ordersCheckedAt: timestamp("orders_checked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("connections_org_marketplace").on(t.organizationId, t.marketplace)],
);

export type ItemAttributes = Record<string, string[]>;

// Notes the AI left on a drafted item, used by later steps (category search, review).
export type DraftNotes = {
  categoryQuery?: string;
  priceNote?: string;
  whenMade?: string;
};

// A set of photos uploaded together. Its number gives drafted items their SKUs ("B12-3").
export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("batches_org_number").on(t.organizationId, t.number)],
);

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
    // What the seller paid for it, for profit on the dashboard. Optional.
    costCents: integer("cost_cents"),
    currency: text("currency").notNull().default("USD"),
    quantity: integer("quantity").notNull().default(1),
    condition: text("condition").notNull().default("USED_GOOD"),
    brand: text("brand"),
    // The seller's own groups for the item, like "Bin 4" or "Consignor: Jane".
    tags: text("tags").array().notNull().default([]),
    attributes: jsonb("attributes").$type<ItemAttributes>().default({}).notNull(),
    status: itemStatusEnum("status").default("draft").notNull(),
    batchId: uuid("batch_id").references(() => batches.id, { onDelete: "set null" }),
    draftNotes: jsonb("draft_notes").$type<DraftNotes>().default({}).notNull(),
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

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

// An uploaded photo, already resized in the browser. The image files are kept on the
// server (lib/photos/store); `data` and `thumb` only hold photos uploaded before that,
// until they're moved out. Served to marketplaces through a signed link (see
// lib/photos). `groupKey` is the item the photo was sorted into before drafting.
export const photos = pgTable("photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => batches.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
  groupKey: integer("group_key"),
  position: integer("position").notNull(),
  fileName: text("file_name"),
  data: bytea("data"),
  thumb: bytea("thumb"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// A store's own version of the item. Anything left out comes from the main item.
export type ListingOverrides = {
  title?: string;
  description?: string;
  condition?: string;
  // The photos this store gets, in order, by URL (item photos are replaced on save).
  imageUrls?: string[];
  priceCents?: number;
  categoryId?: string;
  // Etsy only: when the item was made, e.g. "1990s" or "2020_2026".
  whenMade?: string;
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
    // When the current listing went live (a relist starts a new one).
    listedAt: timestamp("listed_at", { withTimezone: true }),
    lastError: text("last_error"),
    // Extension stores only: the listing URL, and a fingerprint of what was posted,
    // so saving an item only asks the seller to update the store when it changed.
    remoteUrl: text("remote_url"),
    postedFingerprint: text("posted_fingerprint"),
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

// One sold line from a marketplace order. The unique index makes sale handling
// idempotent, so the same order seen by a webhook and by polling counts once.
export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    externalOrderId: text("external_order_id").notNull(),
    externalLineId: text("external_line_id").notNull(),
    sku: text("sku"),
    title: text("title"),
    quantity: integer("quantity").notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
    // Money for the whole line, as the store reported it; null when it didn't.
    currency: text("currency"),
    priceCents: integer("price_cents"),
    shippingCents: integer("shipping_cents"),
    feesCents: integer("fees_cents"),
    feesEstimated: boolean("fees_estimated").notNull().default(false),
    // The store's id for the buyer (eBay username, Etsy user id), for repeat buyers.
    buyerId: text("buyer_id"),
    buyerName: text("buyer_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("sales_connection_line").on(t.connectionId, t.externalLineId),
    index("sales_org_sold").on(t.organizationId, t.soldAt),
  ],
);

// The seller's own note about a buyer, keyed the same way the buyer list groups sales.
export const buyerNotes = pgTable(
  "buyer_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    marketplace: marketplaceEnum("marketplace").notNull(),
    buyerId: text("buyer_id").notNull(),
    note: text("note").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("buyer_notes_org_buyer").on(t.organizationId, t.marketplace, t.buyerId)],
);

export type PostalAddress = {
  name: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
};

export type ParcelSize = { lengthIn: number; widthIn: number; heightIn: number; weightOz: number };

// The account's label-buying setup: its own Shippo key (encrypted), where parcels
// ship from, and the usual box. Each seller pays Shippo for their own postage.
export const shippingSettings = pgTable("shipping_settings", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("shippo"),
  apiTokenEnc: text("api_token_enc"),
  testMode: boolean("test_mode").notNull().default(false),
  fromAddress: jsonb("from_address").$type<PostalAddress>(),
  defaultParcel: jsonb("default_parcel").$type<ParcelSize>(),
  ...timestamps,
});

// A shipping label bought for one marketplace order.
export const shippingLabels = pgTable(
  "shipping_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    externalOrderId: text("external_order_id").notNull(),
    provider: text("provider").notNull(),
    providerLabelId: text("provider_label_id").notNull(),
    carrier: text("carrier").notNull(),
    service: text("service").notNull(),
    costCents: integer("cost_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    labelUrl: text("label_url").notNull(),
    testMode: boolean("test_mode").notNull().default(false),
    // When the tracking number reached the store, or why it didn't.
    trackingSentAt: timestamp("tracking_sent_at", { withTimezone: true }),
    trackingError: text("tracking_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("shipping_labels_order").on(t.organizationId, t.connectionId, t.externalOrderId)],
);

// A browser with the Relistic extension connected to the account. Only a hash of the
// key is kept; the extension sends the key itself as a bearer token.
export const extensionKeys = pgTable("extension_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull().unique(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const extensionTaskKindEnum = pgEnum("extension_task_kind", ["list", "update", "end"]);
export const extensionTaskStatusEnum = pgEnum("extension_task_status", ["open", "done", "failed", "cancelled"]);

// Work for the extension: post, update or take down one listing on an extension store.
// A listing has at most one open task; queuing new work cancels the old task.
export const extensionTasks = pgTable(
  "extension_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => channelListings.id, { onDelete: "cascade" }),
    kind: extensionTaskKindEnum("kind").notNull(),
    status: extensionTaskStatusEnum("status").notNull().default("open"),
    // The fingerprint of the item as queued, recorded on the listing once it's posted.
    fingerprint: text("fingerprint"),
    error: text("error"),
    ...timestamps,
  },
  (t) => [index("extension_tasks_org_status").on(t.organizationId, t.status)],
);

// One row per AI-written draft, counted against the plan's monthly allowance.
export const aiDrafts = pgTable(
  "ai_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("ai_drafts_org_created").on(t.organizationId, t.createdAt)],
);

export const batchesRelations = relations(batches, ({ many }) => ({
  photos: many(photos),
  items: many(items),
}));

export const photosRelations = relations(photos, ({ one }) => ({
  batch: one(batches, { fields: [photos.batchId], references: [batches.id] }),
  item: one(items, { fields: [photos.itemId], references: [items.id] }),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  batch: one(batches, { fields: [items.batchId], references: [batches.id] }),
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

export const extensionTasksRelations = relations(extensionTasks, ({ one }) => ({
  connection: one(connections, { fields: [extensionTasks.connectionId], references: [connections.id] }),
  listing: one(channelListings, { fields: [extensionTasks.listingId], references: [channelListings.id] }),
}));

export const salesRelations = relations(sales, ({ one }) => ({
  item: one(items, { fields: [sales.itemId], references: [items.id] }),
}));

export type Organization = typeof organizations.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Batch = typeof batches.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type ItemImage = typeof itemImages.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type ChannelListing = typeof channelListings.$inferSelect;
export type ExtensionTask = typeof extensionTasks.$inferSelect;
