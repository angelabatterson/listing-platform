ALTER TABLE "items" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "tax_cents" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "refund_cents" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "shipping_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "cost_cents" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "other_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "manual" boolean DEFAULT false NOT NULL;