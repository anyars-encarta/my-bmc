ALTER TABLE attendance_device
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN health_alerted_at timestamptz;
--> statement-breakpoint
ALTER TABLE attendance_record
  ALTER COLUMN clock_in_punch_id DROP NOT NULL,
  ADD COLUMN source varchar(10) NOT NULL DEFAULT 'DEVICE',
  ADD COLUMN manual_clock_in_request_id uuid,
  ADD COLUMN manual_clock_out_request_id uuid,
  ADD CONSTRAINT attendance_record_source_check CHECK (source IN ('DEVICE', 'MANUAL'));
--> statement-breakpoint
CREATE UNIQUE INDEX attendance_manual_clock_in_uq
  ON attendance_record(manual_clock_in_request_id)
  WHERE manual_clock_in_request_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX attendance_manual_clock_out_uq
  ON attendance_record(manual_clock_out_request_id)
  WHERE manual_clock_out_request_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE attendance_exception
  ADD COLUMN job_key varchar(120);
--> statement-breakpoint
CREATE UNIQUE INDEX attendance_exception_job_key_uq
  ON attendance_exception(job_key)
  WHERE job_key IS NOT NULL;
--> statement-breakpoint
ALTER TABLE attendance_correction
  ADD COLUMN requested_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN status varchar(10) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN applied_at timestamptz,
  ADD COLUMN decision_reason text,
  ADD CONSTRAINT attendance_correction_status_check
    CHECK (status IN ('PENDING', 'APPLYING', 'APPROVED', 'REJECTED'));
--> statement-breakpoint
UPDATE attendance_correction
  SET status = 'APPROVED'
  WHERE approved_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX attendance_correction_status_requested_idx
  ON attendance_correction(status, requested_at);
--> statement-breakpoint
CREATE TABLE manual_punch_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id),
  punched_at timestamptz NOT NULL,
  direction varchar(3) NOT NULL CHECK (direction IN ('IN', 'OUT')),
  reason text NOT NULL,
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status varchar(10) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPLYING', 'APPROVED', 'REJECTED')),
  decided_by text,
  decided_at timestamptz,
  decision_reason text
);
--> statement-breakpoint
CREATE INDEX manual_punch_request_status_requested_idx
  ON manual_punch_request(status, requested_at);
--> statement-breakpoint
CREATE TABLE attendance_pilot_setup (
  scope varchar(20) PRIMARY KEY DEFAULT 'RELEASE1',
  ward_unit_id uuid NOT NULL REFERENCES org_unit(id),
  office_unit_id uuid NOT NULL REFERENCES org_unit(id),
  fingerprint_device_id uuid NOT NULL REFERENCES attendance_device(id),
  qr_device_id uuid NOT NULL REFERENCES attendance_device(id),
  training_signed_by text,
  training_signed_at timestamptz,
  tuning_confirmed_at timestamptz,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_pilot_scope_check CHECK (scope = 'RELEASE1'),
  CONSTRAINT attendance_pilot_distinct_units_check CHECK (ward_unit_id <> office_unit_id),
  CONSTRAINT attendance_pilot_distinct_devices_check CHECK (fingerprint_device_id <> qr_device_id)
);
