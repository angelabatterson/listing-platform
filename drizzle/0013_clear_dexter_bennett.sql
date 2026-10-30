ALTER TABLE "channel_listings" ADD COLUMN "listed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "channel_listings" SET "listed_at" = coalesce("last_synced_at", "created_at") WHERE "status" = 'listed';
