-- ============================================================================
-- 024_course_videos_kind.sql
-- ----------------------------------------------------------------------------
-- Extends course_videos so a single table can carry BOTH recorded videos AND
-- trainer-posted live-session join links.
--
--   kind          - 'recorded' (existing default) or 'live'
--   scheduled_at  - when the live session starts. NULL for recordings; the
--                   student-side Sessions tab uses this to sort upcoming
--                   joins chronologically.
--
-- video_url already serves as both the recording URL and the live join URL
-- (Zoom / Meet / YouTube Live / Jitsi etc.) so no schema change there.
-- ============================================================================

BEGIN;

ALTER TABLE course_videos
  ADD COLUMN IF NOT EXISTS kind         VARCHAR(12) NOT NULL DEFAULT 'recorded',
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- Constrain to the two known kinds (idempotent guard).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_videos_kind_check'
  ) THEN
    ALTER TABLE course_videos
      ADD CONSTRAINT course_videos_kind_check
      CHECK (kind IN ('recorded', 'live'));
  END IF;
END $$;

-- Hot path: upcoming-live ordering on the student Sessions tab.
CREATE INDEX IF NOT EXISTS idx_course_videos_live_schedule
  ON course_videos (batch_id, scheduled_at)
  WHERE kind = 'live';

COMMIT;
