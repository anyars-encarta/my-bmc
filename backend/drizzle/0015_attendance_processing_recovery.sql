CREATE TABLE credential_issue_lock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  credential_type varchar(12) NOT NULL,
  lock_token uuid,
  locked_until timestamptz NOT NULL DEFAULT 'epoch'::timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX credential_issue_lock_staff_type_uq
  ON credential_issue_lock(staff_id, credential_type);
--> statement-breakpoint
ALTER TABLE punch_log
  ADD COLUMN processing_started_at timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX attendance_clock_in_punch_uq
  ON attendance_record(clock_in_punch_id);
--> statement-breakpoint
CREATE UNIQUE INDEX attendance_clock_out_punch_uq
  ON attendance_record(clock_out_punch_id)
  WHERE clock_out_punch_id IS NOT NULL;
