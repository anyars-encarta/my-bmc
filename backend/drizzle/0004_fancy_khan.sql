ALTER TABLE "payment_recipients" ADD COLUMN "momo_transfer_reference_id" varchar(100);--> statement-breakpoint
ALTER TABLE "payment_recipients" ADD COLUMN "momo_transfer_status" varchar(20);--> statement-breakpoint
ALTER TABLE "payment_recipients" ADD COLUMN "momo_transfer_status_reason" text;--> statement-breakpoint
ALTER TABLE "payment_recipients" ADD COLUMN "momo_transfer_checked_at" timestamp;