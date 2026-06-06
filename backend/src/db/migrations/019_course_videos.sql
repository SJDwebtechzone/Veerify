-- 019_course_videos.sql
--
-- Course videos shared by the trainer with students in their batch.
-- Used by the new student dashboard's "Recorded Videos" section and by
-- the per-course EnrolledCourseScreen.
--
-- Designed to be batch-scoped: students see videos for the batches they
-- have paid enrollments in. We don't tie videos to courses directly so
-- different batches of the same course can have different video sets
-- (different trainers, different cohorts).
--
-- Trainer upload UI is deferred; rows can be inserted manually via the
-- admin web or directly in the DB until that ships.

BEGIN;

CREATE TABLE IF NOT EXISTS course_videos (
  id                  SERIAL PRIMARY KEY,
  batch_id            INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  title               VARCHAR(200) NOT NULL,
  description         TEXT,
  -- Video URL. Can be a YouTube/Vimeo link, an MP4 hosted on our /uploads
  -- folder, or any other playable source. The mobile player handles each
  -- shape (YouTube embed component for youtube URLs, native video for
  -- everything else).
  video_url           TEXT NOT NULL,
  thumbnail_url       TEXT,
  duration_seconds    INTEGER,
  -- Who uploaded the video. Typically the assigned trainer for the batch,
  -- but could be the institution admin too. ON DELETE SET NULL so an
  -- unenrolled trainer's videos don't disappear with their account.
  uploaded_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Hot path: list videos for a given student's batches, newest first.
CREATE INDEX IF NOT EXISTS idx_course_videos_batch
  ON course_videos (batch_id, created_at DESC);

COMMIT;
