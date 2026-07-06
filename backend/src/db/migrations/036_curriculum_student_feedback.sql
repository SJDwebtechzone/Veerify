-- ============================================================================
-- 036_curriculum_student_feedback.sql
-- ----------------------------------------------------------------------------
-- Add per-lesson student feedback to curriculum progress:
--
--   • student_rating       1–5 self-assessment of how well the student
--                          feels they've grasped the lesson.
--   • student_remarks      Free-text comment from the student (what they
--                          enjoyed, what they want to revisit, etc.).
--   • student_remarked_at  Timestamp of the most recent student-side
--                          update — surfaces "you last updated this on
--                          26 Jun 2026" in the UI.
--
-- These are independent of the existing trainer-side columns
-- (completed_at, completed_by, notes), so:
--   - a student can rate / remark a lesson the trainer hasn't ticked yet
--     (we'll auto-create the progress row on first feedback submit), and
--   - a trainer marking a lesson complete doesn't clear the student's
--     rating / remarks.
-- ============================================================================

ALTER TABLE student_curriculum_progress
  ADD COLUMN IF NOT EXISTS student_rating      SMALLINT
    CHECK (student_rating IS NULL OR student_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS student_remarks     TEXT,
  ADD COLUMN IF NOT EXISTS student_remarked_at TIMESTAMP;
