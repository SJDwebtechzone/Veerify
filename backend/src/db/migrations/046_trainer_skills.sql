-- 046_trainer_skills.sql
--
-- Structured multi-skill support for trainers. Every skill entry
-- carries its own belt level, years of experience, and certificate URL
-- — replaces the "one trainer, one belt / one certificate" model
-- captured by the legacy columns (specialization, belt_level,
-- experience_years, certificate_url).
--
-- Shape stored on trainers.skills (JSONB):
--
--   [
--     { "name": "Karate",  "belt_level": "Black Belt 2nd Dan",
--       "experience_years": 7, "certificate_url": "/uploads/cert-a.pdf" },
--     { "name": "Kung Fu", "belt_level": "Sifu Level",
--       "experience_years": 3, "certificate_url": "/uploads/cert-b.pdf" }
--   ]
--
-- Legacy columns are KEPT (not dropped). Backend code back-fills them
-- from the primary skill on write so existing consumers — student list,
-- admin cards, trainer signup wizard, etc. — keep rendering something
-- sensible without immediate migration.
--
-- NULL / empty array is fine — trainers can be created without any
-- skills (they'll show 'No skills added' in the UI).

ALTER TABLE trainers
  ADD COLUMN IF NOT EXISTS skills JSONB DEFAULT '[]'::jsonb;
