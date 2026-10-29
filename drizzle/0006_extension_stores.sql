CREATE TYPE "public"."extension_task_kind" AS ENUM('list', 'update', 'end');--> statement-breakpoint
CREATE TYPE "public"."extension_task_status" AS ENUM('open', 'done', 'failed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."listing_status" ADD VALUE 'waiting';--> statement-breakpoint
ALTER TYPE "public"."marketplace" ADD VALUE 'poshmark';--> statement-breakpoint
ALTER TYPE "public"."marketplace" ADD VALUE 'depop';--> statement-breakpoint
ALTER TYPE "public"."marketplace" ADD VALUE 'facebook';--> statement-breakpoint
CREATE TABLE "extension_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "extension_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"kind" "extension_task_kind" NOT NULL,
	"status" "extension_task_status" DEFAULT 'open' NOT NULL,
	"fingerprint" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "access_token_enc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "access_token_expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN "remote_url" text;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN "posted_fingerprint" text;--> statement-breakpoint
ALTER TABLE "extension_keys" ADD CONSTRAINT "extension_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_keys" ADD CONSTRAINT "extension_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_tasks" ADD CONSTRAINT "extension_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_tasks" ADD CONSTRAINT "extension_tasks_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_tasks" ADD CONSTRAINT "extension_tasks_listing_id_channel_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."channel_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extension_tasks_org_status" ON "extension_tasks" USING btree ("organization_id","status");