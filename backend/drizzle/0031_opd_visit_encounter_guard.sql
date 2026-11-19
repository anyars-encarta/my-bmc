ALTER TABLE visit
  ADD COLUMN open_encounter_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE visit
SET open_encounter_count = (
  SELECT count(*)::integer
  FROM encounter
  WHERE encounter.visit_id = visit.id AND encounter.status <> 'SIGNED'
);
