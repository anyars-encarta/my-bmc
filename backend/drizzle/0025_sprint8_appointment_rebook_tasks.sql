CREATE TABLE appointment_rebook_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointment(id),
  closed_slot_id uuid NOT NULL REFERENCES appointment_slot(id),
  status varchar(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT appointment_rebook_task_appointment_slot_uq UNIQUE (appointment_id, closed_slot_id)
);
