ALTER TABLE "photos" DROP CONSTRAINT "photos_batch_id_batches_id_fk";
--> statement-breakpoint
ALTER TABLE "photos" ALTER COLUMN "batch_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;