ALTER TABLE notification
  DROP CONSTRAINT IF EXISTS notification_status_check;

ALTER TABLE notification
  ADD CONSTRAINT notification_status_check
  CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED_NO_CONSENT', 'CANCELLED'));
