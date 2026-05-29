-- ============================================================================
-- 009_attendance_status_leave.sql
-- ----------------------------------------------------------------------------
-- The Staff module's attendance UI lets a trainer mark a student as
-- "Leave" (sanctioned absence) in addition to Present / Absent / Late.
-- The original CHECK constraint only allowed three values; widen it to four.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_status_check'
  ) THEN
    ALTER TABLE attendance DROP CONSTRAINT attendance_status_check;
  END IF;
END $$;

ALTER TABLE attendance
  ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('present', 'absent', 'late', 'leave'));
