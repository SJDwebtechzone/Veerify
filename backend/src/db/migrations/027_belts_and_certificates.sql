-- ============================================================================
-- 027_belts_and_certificates.sql
-- ----------------------------------------------------------------------------
-- Belt Badges & Certifications module.
--
-- Three tables:
--   belt_levels                — per-institution belt sequence (sortable).
--                                Default 7 belts seeded on first read via the
--                                controller, not here, so an institution that
--                                wants 9 belts won't get spurious rows.
--   student_belt_promotions    — one row per (student, belt) award. The
--                                student's CURRENT belt is the most recent
--                                row by promoted_at.
--   certificates               — generic table for belt / tournament /
--                                completion / achievement certs. Belt promos
--                                auto-insert a 'belt' cert; tournament certs
--                                are inserted manually by staff. qr_token is
--                                a short URL-safe string we render as a QR
--                                pointing to /certificates/verify/:token.
-- ============================================================================

BEGIN;

-- ── Belt levels (per institution) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS belt_levels (
  id              SERIAL PRIMARY KEY,
  institution_id  INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name            VARCHAR(60) NOT NULL,
  color_hex       VARCHAR(9)  NOT NULL DEFAULT '#FFFFFF',  -- white default
  emoji           VARCHAR(8),                              -- e.g. '⚪', '🟡'
  sort_order      INTEGER     NOT NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (institution_id, name),
  UNIQUE (institution_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_belt_levels_institution
  ON belt_levels(institution_id, sort_order);

-- ── Promotions (audit log of every belt a student has earned) ───────────────
CREATE TABLE IF NOT EXISTS student_belt_promotions (
  id                SERIAL PRIMARY KEY,
  student_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  belt_level_id     INTEGER NOT NULL REFERENCES belt_levels(id) ON DELETE CASCADE,
  institution_id    INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  promoted_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  promoted_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  instructor_name   VARCHAR(120),
  performance_notes TEXT,
  remarks           TEXT,
  signature_url     TEXT,
  academy_seal_url  TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'published'
                      CHECK (status IN ('draft', 'published')),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- A student cannot receive the SAME belt twice.
  UNIQUE (student_id, belt_level_id)
);

CREATE INDEX IF NOT EXISTS idx_promotions_student
  ON student_belt_promotions(student_id, promoted_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotions_institution
  ON student_belt_promotions(institution_id, promoted_at DESC);

-- ── Certificates ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS certificates (
  id                  SERIAL PRIMARY KEY,
  student_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_id      INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  kind                VARCHAR(20) NOT NULL
                        CHECK (kind IN ('belt', 'tournament', 'completion', 'achievement')),
  title               VARCHAR(200) NOT NULL,
  description         TEXT,
  issue_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  instructor_name     VARCHAR(120),
  certificate_no      VARCHAR(40) UNIQUE NOT NULL,
  qr_token            VARCHAR(40) UNIQUE NOT NULL,
  promotion_id        INTEGER REFERENCES student_belt_promotions(id) ON DELETE SET NULL,
  signature_url       TEXT,
  academy_seal_url    TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'verified'
                        CHECK (status IN ('verified', 'revoked')),
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_certificates_student
  ON certificates(student_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_certificates_institution
  ON certificates(institution_id, issue_date DESC);

COMMIT;
