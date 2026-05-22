-- ============================================================================
-- 007_course_media_curriculum.sql
-- ----------------------------------------------------------------------------
-- Adds two more course columns the design needs:
--   intro_video_url — short preview reel shown on the detail page
--   curriculum      — JSONB array of lessons, each:
--                     { "title": string, "duration": string, "is_free": bool }
--
-- We use JSONB (not a separate lessons table) because lessons are write-rarely,
-- read-with-the-course, and the admin form treats them as a single bundle.
-- If we ever need per-lesson analytics / progress we can promote to a real
-- table without breaking the API shape.
-- ============================================================================

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS intro_video_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS curriculum      JSONB DEFAULT '[]'::jsonb;

-- Sanity check — curriculum must be an array, not an object or scalar. Stops
-- a malformed admin POST from corrupting the shape student screens expect.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'courses_curriculum_is_array_chk'
  ) THEN
    ALTER TABLE courses
      ADD CONSTRAINT courses_curriculum_is_array_chk
      CHECK (curriculum IS NULL OR jsonb_typeof(curriculum) = 'array');
  END IF;
END $$;
