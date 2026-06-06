-- ============================================================================
-- 025_performance_reports.sql
-- ----------------------------------------------------------------------------
-- Trainer-issued student performance reports.
--
-- Workflow:
--   trainer (or institution admin) creates the report in 'draft' status,
--   tweaks it across sessions, then publishes it. On publish:
--     - status flips to 'published'
--     - published_at is stamped
--     - the student (+ linked parents) get a notification fan-out
--   Once published, the student app surfaces it in My Performance Reports;
--   the parent app shows it under the linked child.
--
-- We snapshot ratings as small ints (1-5) with check constraints rather
-- than a numeric scale so we can index aggregate dashboards later (avg
-- discipline_rating per batch etc.) without floating-point pain.
--
-- next_goals is a jsonb array of strings so we can both store free-form
-- trainer-typed goals and pre-defined chips without a separate table.
--
-- media_urls is also jsonb — array of { url, kind: 'image' | 'video',
-- thumbnail_url? } objects. Upload flow stores files via /api/uploads as
-- usual; this table only keeps the references.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS performance_reports (
  id                  SERIAL PRIMARY KEY,

  -- Scope: which student / batch / institution the report belongs to.
  -- student_id is FK to users(role='student'); batch_id is optional so a
  -- summary report not tied to a specific batch can still be stored.
  student_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trainer_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  batch_id            INTEGER REFERENCES batches(id) ON DELETE SET NULL,
  institution_id      INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,

  -- Section 1
  report_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  belt_level          VARCHAR(20),

  -- Section 2 — 1-5 ratings, NULL when the trainer skipped that dimension.
  discipline_rating   INTEGER CHECK (discipline_rating BETWEEN 1 AND 5),
  attendance_rating   INTEGER CHECK (attendance_rating BETWEEN 1 AND 5),
  technique_rating    INTEGER CHECK (technique_rating BETWEEN 1 AND 5),
  fitness_rating      INTEGER CHECK (fitness_rating  BETWEEN 1 AND 5),
  sparring_rating     INTEGER CHECK (sparring_rating BETWEEN 1 AND 5),
  behaviour_rating    INTEGER CHECK (behaviour_rating BETWEEN 1 AND 5),

  -- Section 3 / 4 / 5
  strengths           TEXT,
  improvements        TEXT,
  trainer_remarks     TEXT,

  -- Section 6 — jsonb array of strings (goals).
  next_goals          JSONB DEFAULT '[]'::jsonb,

  -- Section 7
  classes_attended    INTEGER,
  classes_missed      INTEGER,

  -- Section 8 — jsonb array of media descriptors.
  media_urls          JSONB DEFAULT '[]'::jsonb,

  -- Section 9
  visible_to_student  BOOLEAN DEFAULT TRUE,
  visible_to_parent   BOOLEAN DEFAULT TRUE,

  -- Lifecycle
  status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published')),
  published_at        TIMESTAMP,

  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_performance_reports_student
  ON performance_reports(student_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_performance_reports_trainer
  ON performance_reports(trainer_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_performance_reports_institution
  ON performance_reports(institution_id, status);

COMMIT;
