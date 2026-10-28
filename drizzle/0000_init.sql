CREATE TYPE "public"."connection_status" AS ENUM('active', 'needs_reauth', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('draft', 'active', 'sold_out', 'archived');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('not_listed', 'listed', 'ended', 'error');--> statement-breakpoint
CREATE TYPE "public"."marketplace" AS ENUM('ebay', 'etsy');--> statement-breakpoint
CREATE TABLE "channel_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"remote_listing_id" text,
	"remote_offer_id" text,
	"status" "listing_status" DEFAULT 'not_listed' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"environment" text NOT NULL,
	"external_account_id" text,
	"display_name" text,
	"access_token_enc" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_enc" text,
	"refresh_token_expires_at" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"url" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"condition" text DEFAULT 'USED_GOOD' NOT NULL,
	"brand" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "item_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_id" uuid,
	"connection_id" uuid,
	"action" text NOT NULL,
	"ok" boolean NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "channel_listings" ADD CONSTRAINT "channel_listings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD CONSTRAINT "channel_listings_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_images" ADD CONSTRAINT "item_images_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_listings_item_connection" ON "channel_listings" USING btree ("item_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_org_marketplace" ON "connections" USING btree ("organization_id","marketplace");--> statement-breakpoint
CREATE UNIQUE INDEX "items_org_sku" ON "items" USING btree ("organization_id","sku");