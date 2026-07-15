-- 057_certificate_template_fields.sql
--
-- Enhances certificate_templates with:
--
--   • signature_url TEXT — uploaded PNG (transparent bg preferred) that
--     renders wherever the `digital_signature` placeholder pin sits AND
--     only when that pin's `active` flag is true.
--
--   • seal_url TEXT — same treatment for the academy seal / stamp
--     used behind the `seal` placeholder pin.
--
-- The existing `placeholders` JSONB column already carries per-pin
-- style + coordinate data. This migration doesn't touch its schema —
-- the `active` boolean per pin is introduced at the application layer
-- (sanitisePin adds it with a `TRUE` default, and the renderer skips
-- any pin whose `active` is explicitly false). Backfilling isn't
-- needed: absent = truthy in the sanitiser.

BEGIN;

ALTER TABLE certificate_templates
  ADD COLUMN IF NOT EXISTS signature_url TEXT,
  ADD COLUMN IF NOT EXISTS seal_url      TEXT;

COMMIT;
