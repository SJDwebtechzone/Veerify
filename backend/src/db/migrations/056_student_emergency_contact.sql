-- 056_student_emergency_contact.sql
--
-- Adds a dedicated `emergency_contact` column to student_profiles so
-- the student's own contact_number stays separate from the emergency
-- contact number the mobile Edit Profile screen captures.
--
-- Legacy rows keep working: contact_number is untouched, and the
-- endpoint's read paths fall back to contact_number when
-- emergency_contact is null so old data still renders.

ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(20);
