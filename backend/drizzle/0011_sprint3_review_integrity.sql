ALTER TABLE hosting_renewal
  ADD COLUMN IF NOT EXISTS service_charge_reference varchar(120);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS hosting_renewal_service_charge_reference_unique
  ON hosting_renewal(service_charge_reference);
--> statement-breakpoint
ALTER TABLE transfer_batch
  DROP CONSTRAINT IF EXISTS transfer_batch_status_check,
  DROP CONSTRAINT IF EXISTS chk_transfer_batch_status;
--> statement-breakpoint
ALTER TABLE transfer_batch
  ADD CONSTRAINT chk_transfer_batch_status
  CHECK (status IN ('DRAFT', 'APPROVED', 'APPLYING', 'APPLIED', 'CANCELLED'));
