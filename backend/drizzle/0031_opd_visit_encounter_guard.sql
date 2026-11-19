ALTER TABLE visit
  ADD COLUMN IF NOT EXISTS open_encounter_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DO $$
DECLARE
  visit_row record;
BEGIN
  FOR visit_row IN SELECT id FROM visit ORDER BY id FOR UPDATE LOOP
    UPDATE visit
    SET open_encounter_count = (
      SELECT count(*)::integer
      FROM encounter
      WHERE encounter.visit_id = visit_row.id AND encounter.status <> 'SIGNED'
    )
    WHERE id = visit_row.id;
  END LOOP;
END
$$;
