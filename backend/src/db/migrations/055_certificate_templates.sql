-- 055_certificate_templates.sql
--
-- Institution-owned certificate templates. An institution admin uploads
-- a background (PDF/image) via /uploads, then places placeholder pins
-- (Student Name / Course Name / Belt / …) on it via the mobile editor.
-- The pin positions are stored as JSONB so a single row captures the
-- whole layout without per-field columns.
--
-- One template can be marked default per institution (partial unique
-- index below). "Send Certificate" on the admin's Certificates screen
-- opens the default (or a picked) template, merges the placeholders
-- with the student's real data, and stores a rendered snapshot on
-- certificates.render_url so the student's view is instant.

BEGIN;

CREATE TABLE IF NOT EXISTS certificate_templates (
  id                SERIAL PRIMARY KEY,
  institution_id    INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  -- Background image / PDF path (relative /uploads/…). Rendered on
  -- the mobile as the certificate canvas; placeholders float on top.
  background_url    TEXT NOT NULL,
  background_kind   TEXT NOT NULL DEFAULT 'image'
                    CHECK (background_kind IN ('image', 'pdf')),
  -- Canvas dimensions the placeholder positions were captured against.
  -- The mobile / renderer uses this to keep proportions when scaling.
  canvas_width      INTEGER NOT NULL DEFAULT 1000,
  canvas_height     INTEGER NOT NULL DEFAULT 700,
  -- Array of placeholder pins:
  --   [{ key: 'student_name', label: 'Student Name',
  --      x: 0.5, y: 0.42, font_size: 24, color: '#111827',
  --      align: 'center', bold: true }, ...]
  -- x/y are RELATIVE (0-1) so the layout survives DPI / resize.
  placeholders      JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot read: "list this institution's templates".
CREATE INDEX IF NOT EXISTS idx_cert_templates_institution
  ON certificate_templates (institution_id, created_at DESC);

-- Only one default per institution.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cert_templates_default_per_inst
  ON certificate_templates (institution_id)
  WHERE is_default = TRUE;

-- ── Extend certificates table so a generated cert can reference its
--    template + carry the merged placeholder payload for later re-render.
ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS template_id      INTEGER REFERENCES certificate_templates(id) ON DELETE SET NULL,
  -- Merged placeholder payload — same shape as templates.placeholders
  -- but each pin now carries a `value` field with the student's real
  -- data. Kept for audit + re-download without hitting live tables.
  ADD COLUMN IF NOT EXISTS placeholder_data JSONB,
  -- URL to the rendered final artifact (PNG / PDF). Filled by the
  -- backend after successful render; nullable so the flow still works
  -- when render is deferred.
  ADD COLUMN IF NOT EXISTS render_url       TEXT,
  ADD COLUMN IF NOT EXISTS certificate_no   TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS course_id        INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trainer_remarks  TEXT;

COMMIT;
