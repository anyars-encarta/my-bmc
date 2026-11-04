ALTER TABLE roster_entry
  ADD COLUMN IF NOT EXISTS override_reason text;
--> statement-breakpoint
DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'roster_entry'::regclass
      AND contype IN ('u', 'x')
  LOOP
    EXECUTE format('ALTER TABLE roster_entry DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE roster_entry
  ADD CONSTRAINT roster_entry_staff_time_excl
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(planned_start, planned_end, '[)') WITH &&
  )
  WHERE (status = 'ACTIVE')
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE roster_entry
  ADD CONSTRAINT roster_entry_planned_window_check
  CHECK (planned_end > planned_start);
--> statement-breakpoint
CREATE UNIQUE INDEX roster_entry_active_staff_date_shift_uq
  ON roster_entry(staff_id, roster_date, shift_type_id)
  WHERE status = 'ACTIVE';
--> statement-breakpoint
CREATE TABLE roster_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id uuid NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_unit_id, name)
);
--> statement-breakpoint
CREATE TABLE roster_template_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_template_id uuid NOT NULL REFERENCES roster_template(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  shift_type_id uuid NOT NULL REFERENCES shift_type(id),
  UNIQUE (roster_template_id, staff_id, day_of_week)
);
--> statement-breakpoint
CREATE TABLE roster_entry_change (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_period_id uuid NOT NULL REFERENCES roster_period(id) ON DELETE CASCADE,
  roster_entry_id uuid REFERENCES roster_entry(id) ON DELETE SET NULL,
  staff_id uuid NOT NULL REFERENCES staff(id),
  roster_date date NOT NULL,
  action varchar(12) NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'CANCELLED')),
  before jsonb,
  after jsonb,
  reason text,
  actor_user_id text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX roster_entry_change_period_date_idx
  ON roster_entry_change(roster_period_id, roster_date, changed_at);
