CREATE TYPE "public"."payment_status" AS ENUM('draft', 'pending_approval', 'approved', 'processing', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."recipient_status" AS ENUM('pending', 'approved', 'disapproved');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"status" "recipient_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"verified_by" text,
	"verified_at" timestamp,
	"added_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"category_id" uuid NOT NULL,
	"status" "payment_status" DEFAULT 'draft' NOT NULL,
	"total_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"created_by" text NOT NULL,
	"submitted_at" timestamp,
	"approving_officer" text,
	"approved_by" text,
	"approved_at" timestamp,
	"processed_by" text,
	"processed_at" timestamp,
	"momo_reference_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(20),
	"employee_id" varchar(50) NOT NULL,
	"department" varchar(100),
	"position" varchar(100),
	"momo_number" varchar(20) NOT NULL,
	"momo_name" varchar(200),
	"status" "staff_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_recipients" ADD CONSTRAINT "payment_recipients_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recipients" ADD CONSTRAINT "payment_recipients_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_idx" ON "categories" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_email_idx" ON "staff" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_employee_id_idx" ON "staff" USING btree ("employee_id");