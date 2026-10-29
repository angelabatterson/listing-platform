CREATE TABLE "buyer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"buyer_id" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "cost_cents" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "shipping_cents" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "fees_cents" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "fees_estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "buyer_id" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "buyer_name" text;--> statement-breakpoint
ALTER TABLE "buyer_notes" ADD CONSTRAINT "buyer_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_notes_org_buyer" ON "buyer_notes" USING btree ("organization_id","marketplace","buyer_id");--> statement-breakpoint
CREATE INDEX "sales_org_sold" ON "sales" USING btree ("organization_id","sold_at");