ALTER TABLE staff_credential
  ADD COLUMN enrollment_note text;
--> statement-breakpoint
ALTER TABLE attendance_device
  ADD COLUMN rate_limit_window_start timestamptz,
  ADD COLUMN rate_limit_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_punch_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'punch_log rows cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    OLD.id,
    OLD.device_id,
    OLD.device_event_id,
    OLD.credential_type,
    OLD.credential_ref,
    OLD.punched_at,
    OLD.received_at,
    OLD.direction_hint,
    OLD.verify_mode,
    OLD.raw_payload
  ) IS DISTINCT FROM ROW(
    NEW.id,
    NEW.device_id,
    NEW.device_event_id,
    NEW.credential_type,
    NEW.credential_ref,
    NEW.punched_at,
    NEW.received_at,
    NEW.direction_hint,
    NEW.verify_mode,
    NEW.raw_payload
  ) THEN
    RAISE EXCEPTION 'punch_log event data is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER punch_log_append_only
  BEFORE UPDATE OR DELETE ON punch_log
  FOR EACH ROW EXECUTE FUNCTION prevent_punch_log_mutation();
