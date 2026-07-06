-- ============================================================================
-- 039_institution_banners.sql
-- ----------------------------------------------------------------------------
-- Per-institution promotional banners.
--
-- The institution admin uploads a banner image (via /api/uploads), gives
-- it an optional title + subtitle + tap-through link, and picks who
-- should see it: students, trainers, or both. Banners are rendered:
--
--   • Students → on the student-app Home tab, scoped to the picked
--     academy (the existing CMS-banner carousel renders them too).
--   • Trainers → on the trainer-app dashboard, in a small carousel
--     above the quick actions.
--
-- audience:
--   'student'  — only shown to students enrolled at this institution
--   'trainer'  — only shown to trainers working at this institution
--   'both'     — visible to both
--
-- The is_active flag lets admins prep a banner without showing it yet
-- (or pull one without deleting it). sort_order lets them control the
-- carousel sequence.
-- ============================================================================

CREATE TABLE IF NOT EXISTS institution_banners (
  id              SERIAL PRIMARY KEY,
  institution_id  INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  image_url       VARCHAR(500) NOT NULL,
  title           VARCHAR(150),
  subtitle        VARCHAR(300),
  link_url        VARCHAR(500),
  audience        VARCHAR(10) NOT NULL DEFAULT 'both'
                    CHECK (audience IN ('student', 'trainer', 'both')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- Hot read path: "all active banners for this institution + audience"
-- — runs every time a student or trainer opens their home screen.
CREATE INDEX IF NOT EXISTS idx_institution_banners_inst_audience
  ON institution_banners (institution_id, audience, is_active);
