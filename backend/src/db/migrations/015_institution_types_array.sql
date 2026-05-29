-- 015_institution_types_array.sql
--
-- Owners can now classify their institution under multiple types
-- (e.g. "School" + "Karate" + "Training Center"). We add a new
-- institution_types TEXT[] column for the full set and keep the
-- existing institution_type VARCHAR(50) column populated with the
-- first / primary entry so legacy code (student browse, admin lists,
-- onboarding controllers, etc.) keeps working without a sweep.
--
-- Backfill rule: any row that already has a non-empty
-- institution_type gets a one-element array placed in institution_types,
-- so existing institutions don't show a blank type after deploy.

BEGIN;

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS institution_types TEXT[];

UPDATE institutions
   SET institution_types = ARRAY[institution_type]
 WHERE institution_types IS NULL
   AND institution_type IS NOT NULL
   AND institution_type <> '';

COMMIT;
