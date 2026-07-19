-- 066_student_profiles_blood_belt.sql
--
-- Adds the two profile fields the mobile Student Enrollment Form has
-- been sending since day one but which never had storage on the
-- backend: blood group and the student's current belt category. Both
-- surface in the admin Edit Student form so an institution / branch
-- admin can update them without touching the student's enrollment
-- record or payment status.
--
--   blood_group    — one of the 8 standard ABO/Rh values
--                    ('A+','A-','B+','B-','AB+','AB-','O+','O-')
--                    or NULL when not disclosed.
--   belt_category  — free text so an academy running a non-standard
--                    belt system (e.g. dan grades, coloured stripes,
--                    "Assistant Instructor") can capture whatever
--                    label they use. The mobile picker offers a
--                    curated list plus an "Other" input.
--
-- Both columns are nullable + have no default; existing rows keep
-- reading as NULL until the profile is next saved.
BEGIN;

ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS blood_group    VARCHAR(4),
  ADD COLUMN IF NOT EXISTS belt_category  VARCHAR(80);

COMMIT;
