ALTER TABLE visit
  ADD COLUMN IF NOT EXISTS open_encounter_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DO $$
BEGIN
  LOCK TABLE visit IN SHARE ROW EXCLUSIVE MODE;
  UPDATE visit AS target
  SET open_encounter_count = counts.open_count
  FROM (
    SELECT visit_row.id,
      count(encounter_row.id) FILTER (WHERE encounter_row.status <> 'SIGNED')::integer AS open_count
    FROM visit AS visit_row
    LEFT JOIN encounter AS encounter_row ON encounter_row.visit_id = visit_row.id
    GROUP BY visit_row.id
  ) AS counts
  WHERE target.id = counts.id;
END
$$;
