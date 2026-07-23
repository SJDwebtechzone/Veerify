-- 069_faqs.sql
--
-- Dynamic FAQ module. Content is managed from the super-admin web
-- panel and rendered on the mobile app filtered by the caller's role.
--
--   question       — plain text; the question itself.
--   answer         — rich-text HTML (produced by RichTextEditor on
--                    the admin web). The mobile renders it via a
--                    lightweight HTML parser / rich text component.
--   category       — free-form grouping label (General, Account,
--                    Courses, Payments, Attendance, Certificates,
--                    Events, Support, etc.). NOT a foreign key so
--                    the admin can add new categories inline.
--   audience       — array of roles this FAQ is visible to. Values
--                    are drawn from the app's canonical role list:
--                    guest, student, trainer, admin (institution),
--                    branch, parent. Multi-select on the admin web
--                    lands here as multiple array entries. A GIN
--                    index gives us fast "row includes X" lookups.
--   display_order  — smaller numbers surface first inside a category.
--   is_active      — soft-disable toggle. Only active rows leak to
--                    mobile consumers.
--
-- Kept role-agnostic — no institution_id column. The FAQ catalogue is
-- platform-wide; per-institution FAQs weren't part of the spec and
-- adding them later is a follow-up migration.

BEGIN;

CREATE TABLE IF NOT EXISTS faqs (
  id             SERIAL PRIMARY KEY,
  question       TEXT NOT NULL,
  answer         TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'General',
  audience       TEXT[] NOT NULL DEFAULT ARRAY['student','trainer','admin']::TEXT[],
  display_order  INTEGER NOT NULL DEFAULT 100,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot read: "list active FAQs whose audience contains :role", grouped
-- by category and sorted by display_order. Both the audience membership
-- check and the sort benefit from indexes.
CREATE INDEX IF NOT EXISTS idx_faqs_audience_gin
  ON faqs USING GIN (audience);

CREATE INDEX IF NOT EXISTS idx_faqs_active_order
  ON faqs (is_active, category, display_order);

COMMIT;
