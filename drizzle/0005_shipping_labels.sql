CREATE TABLE "shipping_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_order_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_label_id" text NOT NULL,
	"carrier" text NOT NULL,
	"service" text NOT NULL,
	"cost_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"tracking_number" text,
	"tracking_url" text,
	"label_url" text NOT NULL,
	"test_mode" boolean DEFAULT false NOT NULL,
	"tracking_sent_at" timestamp with time zone,
	"tracking_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'shippo' NOT NULL,
	"api_token_enc" text,
	"test_mode" boolean DEFAULT false NOT NULL,
	"from_address" jsonb,
	"default_parcel" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD CONSTRAINT "shipping_labels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD CONSTRAINT "shipping_labels_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_settings" ADD CONSTRAINT "shipping_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipping_labels_order" ON "shipping_labels" USING btree ("organization_id","connection_id","external_order_id");