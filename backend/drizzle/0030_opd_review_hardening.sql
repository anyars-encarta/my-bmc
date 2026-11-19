ALTER TABLE diagnosis DROP CONSTRAINT IF EXISTS diagnosis_icd10_code_fkey;
--> statement-breakpoint
ALTER TABLE vital_sign ALTER COLUMN temperature_c TYPE numeric(5,2);
