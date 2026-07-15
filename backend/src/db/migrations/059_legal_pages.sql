-- 059_legal_pages.sql
--
-- Unified table for every editable "policy" page across the platform.
-- Two scopes live here so we don't split rich-text CRUD across two
-- tables and two controllers:
--
--   scope='platform'    → managed only by super_admin. institution_id
--                          is NULL. Visible to every user on the
--                          platform (student / trainer / admin) via
--                          their role-scoped read endpoints.
--
--   scope='institution' → managed only by the owning institution
--                          admin. institution_id points at the parent
--                          institutions row. Visible to that
--                          institution's students / trainers.
--
-- `slug` is the machine key (terms_and_conditions, privacy_policy,
-- academy_rules, …). Uniqueness is enforced per (scope, institution_id,
-- slug) so different institutions can each publish an "academy_rules"
-- page without colliding.
--
-- `content` is stored as TEXT and rendered as plain markdown / HTML on
-- the client. We don't pick a format here — the admin editor treats it
-- as multi-line prose and the read-only viewer renders it verbatim.
--
-- `is_published` gates whether the read endpoints (student / trainer)
-- surface the row. Drafts stay editable but hidden.

BEGIN;

CREATE TABLE IF NOT EXISTS legal_pages (
  id              SERIAL PRIMARY KEY,
  scope           VARCHAR(20) NOT NULL
                    CHECK (scope IN ('platform', 'institution')),
  institution_id  INTEGER REFERENCES institutions(id) ON DELETE CASCADE,
  slug            VARCHAR(80) NOT NULL,
  title           VARCHAR(200) NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Platform rows must NOT carry an institution_id, and institution rows
-- must carry one. These partial indexes enforce that alongside the
-- CHECK below so the API layer can't accidentally persist a hybrid.
ALTER TABLE legal_pages DROP CONSTRAINT IF EXISTS legal_pages_scope_institution_ck;
ALTER TABLE legal_pages
  ADD CONSTRAINT legal_pages_scope_institution_ck
  CHECK (
    (scope = 'platform'    AND institution_id IS NULL) OR
    (scope = 'institution' AND institution_id IS NOT NULL)
  );

-- One row per (scope, institution, slug). Two partial-unique indexes
-- because platform rows have institution_id=NULL (which doesn't
-- collide in a plain UNIQUE).
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_pages_platform_slug
  ON legal_pages (slug)
  WHERE scope = 'platform';

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_pages_institution_slug
  ON legal_pages (institution_id, slug)
  WHERE scope = 'institution';

-- Hot read paths: student / trainer opening the Legal tab.
CREATE INDEX IF NOT EXISTS idx_legal_pages_scope_slug
  ON legal_pages (scope, slug) WHERE is_published = TRUE;
CREATE INDEX IF NOT EXISTS idx_legal_pages_institution
  ON legal_pages (institution_id, slug) WHERE scope = 'institution';

COMMIT;
