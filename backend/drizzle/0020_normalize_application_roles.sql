ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'super_admin';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'hospital_admin';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'hr_manager';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'payroll_officer';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'unit_manager';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'roster_officer';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'registrar';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'records_officer';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'cashier';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'billing_officer';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'doctor';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'nurse';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'midwife';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'pharmacist';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'pharmacy_tech';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'lab_scientist';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'radiographer';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'radiologist';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'store_keeper';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'procurement_officer';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'report_viewer';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'auditor';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'dpo';
--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'staff';
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'staff';
--> statement-breakpoint
ALTER TABLE app_user_role DROP CONSTRAINT IF EXISTS app_user_role_ck;
--> statement-breakpoint
WITH ranked_roles AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY user_id, CASE
        WHEN lower(role) = 'admin' THEN 'super_admin'
        ELSE lower(role)
      END
      ORDER BY (
        role = CASE
          WHEN lower(role) = 'admin' THEN 'super_admin'
          ELSE lower(role)
        END
      ) DESC, role
    ) AS duplicate_rank
  FROM app_user_role
)
DELETE FROM app_user_role
WHERE ctid IN (SELECT ctid FROM ranked_roles WHERE duplicate_rank > 1);
--> statement-breakpoint
UPDATE app_user_role
SET role = CASE
  WHEN lower(role) = 'admin' THEN 'super_admin'
  ELSE lower(role)
END;
--> statement-breakpoint
ALTER TABLE app_user_role
  ADD CONSTRAINT app_user_role_ck CHECK (role IN (
    'super_admin',
    'hospital_admin',
    'hr_manager',
    'payroll_officer',
    'unit_manager',
    'roster_officer',
    'registrar',
    'records_officer',
    'cashier',
    'accounts',
    'billing_officer',
    'doctor',
    'nurse',
    'midwife',
    'pharmacist',
    'pharmacy_tech',
    'lab_scientist',
    'radiographer',
    'radiologist',
    'store_keeper',
    'procurement_officer',
    'report_viewer',
    'auditor',
    'dpo',
    'staff'
  ));
--> statement-breakpoint
INSERT INTO app_user_role (user_id, role)
SELECT account_user.id,
  CASE
    WHEN lower(account_user.role::text) = 'admin' THEN 'super_admin'
    ELSE lower(account_user.role::text)
  END
FROM "user" AS account_user
WHERE NOT EXISTS (
  SELECT 1
  FROM app_user_role AS assigned_role
  WHERE assigned_role.user_id = account_user.id
);
