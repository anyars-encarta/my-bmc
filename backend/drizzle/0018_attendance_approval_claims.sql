ALTER TABLE attendance_correction
  ADD COLUMN apply_claim_token uuid,
  ADD COLUMN apply_claimed_at timestamptz;
--> statement-breakpoint
CREATE INDEX attendance_correction_applying_claim_idx
  ON attendance_correction(status, apply_claimed_at);
--> statement-breakpoint
ALTER TABLE manual_punch_request
  ADD COLUMN apply_claim_token uuid,
  ADD COLUMN apply_claimed_at timestamptz;
--> statement-breakpoint
CREATE INDEX manual_punch_request_applying_claim_idx
  ON manual_punch_request(status, apply_claimed_at);
