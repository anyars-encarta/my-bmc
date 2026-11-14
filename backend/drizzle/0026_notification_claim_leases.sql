ALTER TABLE notification
  ADD COLUMN IF NOT EXISTS claim_started_at timestamptz;
