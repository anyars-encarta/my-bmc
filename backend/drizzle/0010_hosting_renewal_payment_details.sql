ALTER TABLE hosting_renewal
  ADD COLUMN IF NOT EXISTS created_at timestamptz;
--> statement-breakpoint
UPDATE hosting_renewal
SET created_at = start_date::timestamp AT TIME ZONE 'UTC'
WHERE created_at IS NULL;
--> statement-breakpoint
ALTER TABLE hosting_renewal
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ADD COLUMN IF NOT EXISTS payment_reference varchar(120),
  ADD COLUMN IF NOT EXISTS usd_to_ghs_rate numeric(12, 6),
  ADD COLUMN IF NOT EXISTS status varchar(12) NOT NULL DEFAULT 'COMPLETED';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS hosting_renewal_payment_reference_unique
  ON hosting_renewal(payment_reference);
--> statement-breakpoint
ALTER TABLE hosting_renewal
  ADD CONSTRAINT chk_hosting_renewal_status
  CHECK (status IN ('PENDING', 'COMPLETED'));
