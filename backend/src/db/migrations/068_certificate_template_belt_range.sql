-- 068_certificate_template_belt_range.sql
--
-- Adds a per-template belt range gate on certificate_templates:
--
--   • from_belt          — inclusive lower bound of the belt list.
--   • to_belt            — inclusive upper bound of the belt list.
--   • belt_range_active  — master toggle. TRUE means the range gate is
--                          enforced; FALSE means the template accepts
--                          any belt (behaves as legacy).
--
-- The certificate dispatch flow (POST /course-completions/:id/send-
-- certificate) checks these fields against the student's current belt
-- and rejects with 422 if the belt falls outside the active range.
-- Templates with belt_range_active = FALSE bypass the check entirely,
-- so pre-existing rows keep working after this migration lands.
--
-- Values are stored as TEXT so the labels ("White", "Blue I", "Gray"
-- etc.) round-trip cleanly with the mobile picker without a lookup
-- table. Order is derived at application layer (BELT_ORDER in the
-- certificateTemplate controller).

BEGIN;

ALTER TABLE certificate_templates
  ADD COLUMN IF NOT EXISTS from_belt         TEXT,
  ADD COLUMN IF NOT EXISTS to_belt           TEXT,
  ADD COLUMN IF NOT EXISTS belt_range_active BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
