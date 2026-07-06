-- 043_institution_social_links.sql
--
-- Adds the four social-link columns used by the Academy Profile screen
-- on the More tab. Every column is NULLABLE — existing institution rows
-- keep working without a backfill, and the admin can leave any handle
-- blank to hide that icon on the profile.
--
-- These are stored as full URLs (not just handles) so the mobile can
-- hand them straight to Linking.openURL without composing anything.

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS facebook_url  TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS youtube_url   TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url  TEXT;
