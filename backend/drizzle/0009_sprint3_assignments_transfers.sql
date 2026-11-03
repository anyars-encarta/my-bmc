CREATE TABLE transfer_batch_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_batch_id uuid NOT NULL REFERENCES transfer_batch(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id),
  to_org_unit_id uuid NOT NULL REFERENCES org_unit(id),
  reason varchar(30) NOT NULL DEFAULT 'RESHUFFLE'
    CHECK (reason IN ('INITIAL','TRANSFER','RESHUFFLE','SECONDMENT','COVER','PROMOTION','RETURN')),
  note text,
  UNIQUE (transfer_batch_id, staff_id)
);
--> statement-breakpoint
CREATE TABLE workforce_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(40) NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
--> statement-breakpoint
CREATE INDEX workforce_event_pending_idx ON workforce_event(occurred_at)
  WHERE processed_at IS NULL;
