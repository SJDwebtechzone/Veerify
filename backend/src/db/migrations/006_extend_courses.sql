-- ============================================================================
-- 006_extend_courses.sql
-- ----------------------------------------------------------------------------
-- Adds the columns the student-facing course list + detail screens need.
-- Everything is nullable / has a sensible default so existing rows keep
-- working without backfill.
-- ============================================================================

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS short_description     VARCHAR(200),
  -- Delivery mode for the course. Constrained to three values so the admin
  -- form's toggle never lets junk through.
  ADD COLUMN IF NOT EXISTS mode                  VARCHAR(10) DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS level                 VARCHAR(20) DEFAULT 'Beginner',
  ADD COLUMN IF NOT EXISTS age_group             VARCHAR(40),
  -- Class schedule — shown on the detail screen as "Mon, Wed, Fri" +
  -- "06:00 PM – 07:00 PM". Stored as plain strings so the admin can write
  -- whatever fits their actual schedule.
  ADD COLUMN IF NOT EXISTS days_of_week          VARCHAR(80),
  ADD COLUMN IF NOT EXISTS class_start_time      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS class_end_time        VARCHAR(20),
  -- Batch size range — "20 – 25 Students" in the design.
  ADD COLUMN IF NOT EXISTS batch_size_min        INTEGER,
  ADD COLUMN IF NOT EXISTS batch_size_max        INTEGER,
  ADD COLUMN IF NOT EXISTS language              VARCHAR(80) DEFAULT 'English',
  -- Pricing — `price` (already on the table) is treated as the MONTHLY fee.
  -- We add admission_fee for the one-time joining charge.
  ADD COLUMN IF NOT EXISTS admission_fee         NUMERIC(10, 2) DEFAULT 0,
  -- Perks shown as bullet badges in the detail card.
  ADD COLUMN IF NOT EXISTS belt_system           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS certificate_available BOOLEAN DEFAULT TRUE,
  -- Hero image + badge ("Popular", "New", "Kids Special").
  ADD COLUMN IF NOT EXISTS image_url             VARCHAR(500),
  ADD COLUMN IF NOT EXISTS badge                 VARCHAR(20),
  -- Trainer + branch — both optional FK-less for now; we'll wire FK once
  -- the trainer-assign flow lands.
  ADD COLUMN IF NOT EXISTS trainer_name          VARCHAR(120),
  ADD COLUMN IF NOT EXISTS branch_name           VARCHAR(120),
  -- Lifecycle — admin can publish / archive without deleting.
  ADD COLUMN IF NOT EXISTS status                VARCHAR(20) DEFAULT 'active';

-- Constrain `mode` to the three real values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'courses_mode_chk'
  ) THEN
    ALTER TABLE courses
      ADD CONSTRAINT courses_mode_chk
      CHECK (mode IN ('online', 'offline', 'hybrid'));
  END IF;
END $$;

-- Constrain `status` so the student list query can rely on it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'courses_status_chk'
  ) THEN
    ALTER TABLE courses
      ADD CONSTRAINT courses_status_chk
      CHECK (status IN ('active', 'inactive', 'draft'));
  END IF;
END $$;

-- Constrain `badge` so the UI never sees an unexpected value.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'courses_badge_chk'
  ) THEN
    ALTER TABLE courses
      ADD CONSTRAINT courses_badge_chk
      CHECK (badge IS NULL OR badge IN ('popular', 'new', 'kids_special'));
  END IF;
END $$;

-- Student-facing list is filtered by (institution_id, status='active') — a
-- partial index covers exactly that hot path cheaply.
CREATE INDEX IF NOT EXISTS idx_courses_inst_status
  ON courses (institution_id)
  WHERE status = 'active';
