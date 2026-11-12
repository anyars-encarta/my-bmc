-- Keep every identifier row and value. If active duplicates exist for one patient/type,
-- retain the most recently verified row (then lowest id) as active and mark the rest inactive.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY patient_id, id_type
      ORDER BY verified DESC, verified_at DESC NULLS LAST, id ASC
    ) AS duplicate_rank
  FROM patient_identifier
  WHERE status = 'ACTIVE'
)
UPDATE patient_identifier AS identifier
SET status = 'INACTIVE'
FROM ranked
WHERE identifier.id = ranked.id
  AND ranked.duplicate_rank > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX patient_identifier_patient_type_active_uq
  ON patient_identifier (patient_id, id_type)
  WHERE status = 'ACTIVE';
