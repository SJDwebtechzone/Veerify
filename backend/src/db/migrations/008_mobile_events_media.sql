-- ============================================================================
-- 008_mobile_events_media.sql
-- ----------------------------------------------------------------------------
-- mobile_events was missing the columns the CMS UI and student app already
-- expected to read:
--   subtitle  - short tagline shown under the event title
--   image_url - hero image for the event card
--   link      - optional external URL (registration form, info page, ticket)
-- ============================================================================

ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS subtitle  VARCHAR(300),
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS link      VARCHAR(500);
