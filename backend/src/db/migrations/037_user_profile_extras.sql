-- ============================================================================
-- 037_user_profile_extras.sql
-- ----------------------------------------------------------------------------
-- Backs the "My Profile" page on the super-admin web. Adds:
--
--   • org_name      VARCHAR(150) — name of the organisation the admin
--                                   represents (rendered as "Institution
--                                   Name" on the profile card).
--   • org_logo_url  VARCHAR(500) — relative path (or absolute URL) of the
--                                   logo image uploaded via POST /uploads.
--   • alt_phone     VARCHAR(20)  — alternate contact number.
--
-- All three are nullable: existing rows stay valid, the form can fill them
-- in at any time.
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS org_name      VARCHAR(150),
  ADD COLUMN IF NOT EXISTS org_logo_url  VARCHAR(500),
  ADD COLUMN IF NOT EXISTS alt_phone     VARCHAR(20);
