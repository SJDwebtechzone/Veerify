-- 064_courses_trainer_id.sql
--
-- Adds a proper foreign-key trainer_id column on courses so the
-- institution admin can pick a real trainer from the roster instead
-- of typing a free-text name. The legacy `trainer_name` VARCHAR is
-- kept (migration 006) so existing rows stay readable; the write
-- path now derives it from the picked trainer's users.name for new
-- courses, or the admin's free-text input if no trainer_id was sent.

BEGIN;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_courses_trainer_id
  ON courses (trainer_id)
  WHERE trainer_id IS NOT NULL;

COMMIT;
