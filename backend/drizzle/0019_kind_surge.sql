-- Restored: this file was removed while its journal entry was kept, which stopped db:migrate.
-- IF NOT EXISTS makes it a no-op on databases where 0020 has already added these values.
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'payroll_officer';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'unit_manager';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'roster_officer';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'registrar';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'records_officer';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'cashier';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'billing_officer';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'doctor';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'nurse';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'midwife';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'pharmacist';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'pharmacy_tech';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'lab_scientist';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'radiographer';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'radiologist';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'store_keeper';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'procurement_officer';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'report_viewer';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'auditor';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'dpo';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'staff';--> statement-breakpoint
