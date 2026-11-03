DO $$
DECLARE
    start_ts timestamptz := date_trunc('month', now());
    next_ts timestamptz := date_trunc('month', now()) + interval '1 month';
    after_next_ts timestamptz := date_trunc('month', now()) + interval '2 month';
    current_partition text := format('audit_log_%s', to_char(start_ts, 'YYYY_MM'));
    next_partition text := format('audit_log_%s', to_char(next_ts, 'YYYY_MM'));
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
        current_partition,
        start_ts,
        next_ts
    );

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
        next_partition,
        next_ts,
        after_next_ts
    );
END
$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_log(entity_type, entity_id, occurred_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_patient_idx ON audit_log(patient_id, occurred_at DESC) WHERE patient_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_log(actor_user_id, occurred_at DESC);
