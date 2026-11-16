CREATE TABLE IF NOT EXISTS ews_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  name varchar(100) NOT NULL,
  version integer NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  rules jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ews_policy_dates_ck CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ews_policy_code_version_uq UNIQUE (code, version)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ews_policy_active_date_ix ON ews_policy(effective_from, effective_to) WHERE active = true;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drug_identity_uq
  ON drug (lower(generic_name), form, coalesce(strength_text, ''));

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS outpatient_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient(id),
  visit_id uuid NOT NULL REFERENCES visit(id),
  vital_sign_id uuid NOT NULL UNIQUE REFERENCES vital_sign(id),
  org_unit_id uuid NOT NULL REFERENCES org_unit(id),
  task_type varchar(20) NOT NULL CHECK (task_type IN ('EWS_HIGH')),
  description varchar(300) NOT NULL,
  priority varchar(9) NOT NULL DEFAULT 'URGENT' CHECK (priority IN ('ROUTINE','URGENT','EMERGENCY')),
  status varchar(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by_staff_id uuid REFERENCES staff(id),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolved_by_staff_id uuid REFERENCES staff(id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outpatient_task_open_ix ON outpatient_task(org_unit_id, priority, created_at) WHERE status IN ('OPEN','ACKNOWLEDGED');
