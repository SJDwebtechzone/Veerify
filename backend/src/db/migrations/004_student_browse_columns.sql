-- Migration 004: columns needed by the student-facing browse experience.
--
-- 1. latitude / longitude on institutions
--    Used by /api/institutions/nearby?lat=&lng= to sort by distance and
--    auto-select the closest academy on app launch. Stored as DOUBLE PRECISION
--    so we don't lose precision (DECIMAL would also work but is slower for
--    distance math). NULL allowed — institutions that haven't been geocoded
--    yet are simply excluded from "nearby" results but still appear in
--    "all institutions" lists.
--
-- 2. accepts_students on institutions
--    Lets an academy opt out of student-facing browsing without going inactive
--    on the admin side. Useful when an academy is full or pausing intake.
--    Defaults TRUE so existing rows behave the same as today.
--
-- 3. is_featured on courses (a.k.a. programs in the student UI)
--    Curated by the institution admin via the courses screen. Powers the
--    "Featured Programs" section on the student Home screen. Default FALSE.
--
-- All ALTERs use IF NOT EXISTS so this is safe to re-run.
--
-- Apply via:
--   cd backend
--   npm run migrate -- src/db/migrations/004_student_browse_columns.sql

-- ── 1. institutions ──────────────────────────────────────────────────────────
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS latitude         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS accepts_students BOOLEAN NOT NULL DEFAULT TRUE;

-- Composite index for nearby-institution queries. Postgres will use this for
-- bounding-box pre-filters before the haversine sort.
CREATE INDEX IF NOT EXISTS idx_institutions_lat_lng
  ON institutions (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Partial index for student-facing "active + accepts students" lookup.
CREATE INDEX IF NOT EXISTS idx_institutions_student_browsable
  ON institutions (id)
  WHERE onboarding_status = 'active'
    AND accepts_students = TRUE
    AND is_active = TRUE;

-- ── 2. courses (= programs in student UI) ────────────────────────────────────
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

-- Index lets the Home screen's Featured Programs query stay cheap as the
-- catalog grows.
CREATE INDEX IF NOT EXISTS idx_courses_featured
  ON courses (institution_id, is_featured)
  WHERE is_featured = TRUE;
