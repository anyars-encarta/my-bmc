-- Sprint 7 — Patient registry.
-- The patient, identifier, contact, allergy, condition and merge tables, immutable_unaccent() and the
-- trigram/phonetic indexes were created by 0005_sprint_ready_schema. This migration adds the lookup
-- indexes and the tracking columns that the registry, break-glass and merge workflows rely on.

CREATE INDEX IF NOT EXISTS patient_mrn_pattern_ix ON patient (mrn varchar_pattern_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_registered_ix ON patient (registered_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_updated_ix ON patient (updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_merged_into_ix ON patient (merged_into_id) WHERE merged_into_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_identifier_patient_ix ON patient_identifier (patient_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_identifier_value_ix ON patient_identifier (id_value) WHERE status = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_contact_patient_ix ON patient_contact (patient_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_condition_patient_ix ON patient_condition (patient_id);
--> statement-breakpoint
ALTER TABLE patient_duplicate_candidate
  ADD COLUMN IF NOT EXISTS detected_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS source varchar(12) NOT NULL DEFAULT 'SWEEP'
    CHECK (source IN ('REGISTRATION', 'SWEEP', 'MANUAL'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_dup_status_ix ON patient_duplicate_candidate (status, score DESC);
--> statement-breakpoint
ALTER TABLE patient_merge_task
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_merge_task_open_ix ON patient_merge_task (status)
  WHERE status IN ('PENDING', 'FAILED');
--> statement-breakpoint
ALTER TABLE break_glass_access ADD COLUMN IF NOT EXISTS review_note varchar(500);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS break_glass_active_ix ON break_glass_access (user_id, patient_id, expires_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS break_glass_review_ix ON break_glass_access (granted_at) WHERE reviewed_at IS NULL;
