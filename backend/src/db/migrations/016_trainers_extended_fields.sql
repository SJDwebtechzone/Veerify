-- 016_trainers_extended_fields.sql
--
-- Institution-side staff enrollment now captures more than just contact +
-- specialisation. We add personal, identity, and document columns to the
-- trainers table. All nullable so existing trainer rows remain valid.
--
-- New columns:
--   gender              VARCHAR(20)    -- 'Male' / 'Female' / 'Other' / custom
--   date_of_birth       DATE           -- used to derive age on the client
--   certificate_url     TEXT           -- PDF or image URL (achievement / cert)
--   govt_proof_type     VARCHAR(40)    -- e.g. 'Aadhaar', 'PAN', 'Passport'
--   govt_proof_number   VARCHAR(40)    -- masked / verified separately
--   photo_url           TEXT           -- profile photo
--
-- Existing columns already cover Name (users.name), Contact (users.phone),
-- Skill (trainers.specialization), Experience (trainers.experience_years),
-- and Academy Name (trainers.institution_id -> institutions.name).

BEGIN;

ALTER TABLE trainers ADD COLUMN IF NOT EXISTS gender            VARCHAR(20);
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS date_of_birth     DATE;
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS certificate_url   TEXT;
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS govt_proof_type   VARCHAR(40);
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS govt_proof_number VARCHAR(40);
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS photo_url         TEXT;

COMMIT;
