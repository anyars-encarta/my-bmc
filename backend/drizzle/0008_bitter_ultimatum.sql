DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_type t
		JOIN pg_namespace n ON n.oid = t.typnamespace
		WHERE t.typname = 'staff_category' AND n.nspname = 'public'
	) THEN
		CREATE TYPE "public"."staff_category" AS ENUM('CLINICAL', 'NON_CLINICAL');
	END IF;
END
$$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hosting_renewal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monthly_dollar_rate" numeric(10, 2) NOT NULL,
	"quantity_in_months" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"total_dollar_amount" numeric(10, 2) NOT NULL,
	"total_cedi_equivalent" numeric(10, 2) NOT NULL,
	CONSTRAINT "chk_hosting_renewal_monthly_nonnegative" CHECK ("hosting_renewal"."monthly_dollar_rate" >= 0),
	CONSTRAINT "chk_hosting_renewal_quantity_positive" CHECK ("hosting_renewal"."quantity_in_months" >= 1),
	CONSTRAINT "chk_hosting_renewal_totals_nonnegative" CHECK ("hosting_renewal"."total_dollar_amount" >= 0 and "hosting_renewal"."total_cedi_equivalent" >= 0),
	CONSTRAINT "chk_hosting_renewal_dates_order" CHECK ("hosting_renewal"."start_date" <= "hosting_renewal"."end_date")
);
--> statement-breakpoint
ALTER TABLE "facility_setup" ADD COLUMN IF NOT EXISTS "timezone" varchar(60) DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "facility_setup" ADD COLUMN IF NOT EXISTS "currency" char(3) DEFAULT 'GHS' NOT NULL;--> statement-breakpoint
ALTER TABLE "facility_setup" ADD COLUMN IF NOT EXISTS "locale" varchar(10) DEFAULT 'en-GH' NOT NULL;--> statement-breakpoint
ALTER TABLE "facility_setup" ADD COLUMN IF NOT EXISTS "privacy_policy_version" varchar(20);--> statement-breakpoint
ALTER TABLE "facility_setup" ADD COLUMN IF NOT EXISTS "financial_year_start_month" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "facility_setup" ADD COLUMN IF NOT EXISTS "nhia_facility_code" varchar(30);--> statement-breakpoint
ALTER TABLE "facility_setup" ADD COLUMN IF NOT EXISTS "gps_digital_address" varchar(20);--> statement-breakpoint
ALTER TABLE "facility_setup" ADD COLUMN IF NOT EXISTS "registration_number" varchar(40);--> statement-breakpoint
ALTER TABLE "facility_setup" ADD COLUMN IF NOT EXISTS "hosted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "facility_setup" ADD COLUMN IF NOT EXISTS "hosting_expiry_date" date;--> statement-breakpoint
ALTER TABLE "facility_setup" ADD COLUMN IF NOT EXISTS "monthly_renewal_fee" numeric(10, 2);--> statement-breakpoint