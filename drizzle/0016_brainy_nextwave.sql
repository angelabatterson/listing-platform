ALTER TABLE "items" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "favorite" boolean DEFAULT false NOT NULL;