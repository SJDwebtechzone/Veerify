-- 071_sample_certificate_templates.sql
--
-- Global sample certificate templates published by the super-admin
-- web panel. Two conceptual flavours share the certificate_templates
-- table (avoids a parallel schema for the same rendering pipeline):
--
--   • Sample (is_sample = TRUE)
--       – No institution_id (NULL) — samples aren't owned by any
--         academy. institution_id must therefore become nullable.
--       – Published by super-admin; every institution admin can
--         view + preview + "Use as Template" (copy) but never edit,
--         delete, or replace.
--       – `is_default` on a sample marks the "Default Sample" per
--         the spec — the sample the admin lands on when they open
--         the section for the first time.
--
--   • Institution (is_sample = FALSE, DEFAULT)
--       – Existing behaviour, unchanged. institution_id is required.
--       – When cloned from a sample, `sample_id` points at the
--         source sample so the UI can badge "Based on sample X"
--         and analytics can measure sample uptake.
--
-- The read side is now:
--   • GET /certificate-templates            → institution rows
--   • GET /certificate-templates/samples    → sample rows (public to
--                                              any authenticated admin)
--
-- The partial unique index that used to enforce "one default per
-- institution" now scopes on (is_sample = FALSE) so the sample
-- default lives in its own single-row slot.

BEGIN;

ALTER TABLE certificate_templates
  ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sample_id INTEGER REFERENCES certificate_templates(id) ON DELETE SET NULL;

-- Samples don't belong to any institution — drop the NOT NULL
-- constraint from institution_id so a sample row can exist without
-- an owner. Institution rows still keep a non-null institution_id
-- via the CHECK below.
ALTER TABLE certificate_templates
  ALTER COLUMN institution_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'certificate_templates_scope_shape'
  ) THEN
    ALTER TABLE certificate_templates
      ADD CONSTRAINT certificate_templates_scope_shape
      CHECK (
        (is_sample = TRUE  AND institution_id IS NULL)
        OR
        (is_sample = FALSE AND institution_id IS NOT NULL)
      );
  END IF;
END $$;

-- Rebuild the "one default per institution" index so it applies only
-- to institution rows.
DROP INDEX IF EXISTS uq_cert_templates_default_per_inst;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cert_templates_default_per_inst
  ON certificate_templates (institution_id)
  WHERE is_default = TRUE AND is_sample = FALSE;

-- New "one default sample platform-wide" index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cert_templates_default_sample
  ON certificate_templates ((true))
  WHERE is_default = TRUE AND is_sample = TRUE;

-- Hot reads: list samples, list a sample's clones.
CREATE INDEX IF NOT EXISTS idx_cert_templates_samples
  ON certificate_templates (created_at DESC)
  WHERE is_sample = TRUE;

CREATE INDEX IF NOT EXISTS idx_cert_templates_sample_id
  ON certificate_templates (sample_id)
  WHERE sample_id IS NOT NULL;

COMMIT;
