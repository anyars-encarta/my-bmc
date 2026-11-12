ALTER TABLE notification
  ALTER COLUMN recipient_id TYPE text
  USING recipient_id::text;
