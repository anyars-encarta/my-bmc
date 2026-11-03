ALTER TABLE user_unit_scope
  ADD CONSTRAINT user_unit_scope_org_unit_fk
  FOREIGN KEY (org_unit_id) REFERENCES org_unit(id) ON DELETE CASCADE;
--> statement-breakpoint

INSERT INTO shift_type (code, name, category, start_time, end_time, break_minutes, early_in_minutes, late_out_minutes, grace_late_minutes, active)
VALUES
  ('STD', 'Standard Day', 'STANDARD', '07:00', '16:00', 60, 60, 120, 15, true),
  ('MORNING', 'Morning', 'MORNING', '07:00', '14:00', 0, 60, 120, 15, true),
  ('AFTERNOON', 'Afternoon', 'AFTERNOON', '14:00', '20:00', 0, 60, 120, 15, true),
  ('NIGHT', 'Night', 'NIGHT', '20:00', '07:00', 0, 60, 120, 15, true)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  break_minutes = EXCLUDED.break_minutes,
  early_in_minutes = EXCLUDED.early_in_minutes,
  late_out_minutes = EXCLUDED.late_out_minutes,
  grace_late_minutes = EXCLUDED.grace_late_minutes,
  active = EXCLUDED.active;
--> statement-breakpoint

INSERT INTO job_role (code, name, staff_category, requires_license)
VALUES
  ('MED_OFFICER', 'Medical Officer', 'CLINICAL', true),
  ('STAFF_NURSE', 'Staff Nurse', 'CLINICAL', true),
  ('PHARMACIST', 'Pharmacist', 'CLINICAL', true),
  ('LAB_SCIENTIST', 'Lab Scientist', 'CLINICAL', true),
  ('ACCOUNTANT', 'Accountant', 'NON_CLINICAL', false),
  ('HR_OFFICER', 'HR Officer', 'NON_CLINICAL', false),
  ('STORE_KEEPER', 'Store Keeper', 'NON_CLINICAL', false),
  ('DRIVER', 'Driver', 'NON_CLINICAL', false)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  staff_category = EXCLUDED.staff_category,
  requires_license = EXCLUDED.requires_license;
