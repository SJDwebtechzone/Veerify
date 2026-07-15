-- 060_legal_page_sections.sql
--
-- Extends legal_pages so each policy is a STRUCTURED document with
-- named sections (Introduction, User Accounts, Payments, …) rather
-- than a single free-form blob.
--
-- Shape of the JSONB payload:
--   [
--     { key: 'introduction', title: 'Introduction', content: '<p>…</p>' },
--     { key: 'user_accounts', title: 'User Accounts', content: '<p>…</p>' },
--     …
--   ]
--
-- The `content` field per section is rich-text HTML (produced by the
-- contentEditable-based editor in the admin surfaces). Consumers render
-- it verbatim; there's no server-side sanitisation here because the
-- write endpoints are auth-gated to super_admin / institution admin.
--
-- The existing `content TEXT` column is kept for backward compat with
-- pages saved before this migration (they show up under a synthetic
-- "Overview" section on read).

BEGIN;

ALTER TABLE legal_pages
  ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
