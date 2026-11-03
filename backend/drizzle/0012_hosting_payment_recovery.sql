ALTER TABLE hosting_renewal
  ADD COLUMN IF NOT EXISTS payment_started_at timestamptz;
--> statement-breakpoint
UPDATE hosting_renewal
SET payment_started_at = created_at
WHERE status = 'PENDING'
  AND payment_started_at IS NULL;
