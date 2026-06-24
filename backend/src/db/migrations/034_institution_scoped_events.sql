-- 034_institution_scoped_events.sql
--
-- mobile_events was global-only — the super admin curated rows that every
-- mobile user saw. Institution admins now need to publish their own events
-- (camp announcements, grading day, end-of-term ceremony) which should
-- show up on the home screens of their students AND their trainers.
--
-- institution_id is NULLABLE so the existing global rows keep rendering
-- everywhere they always did. New rows can carry an institution_id to
-- scope them to one academy's audience.
--
-- description gives the create-event form somewhere to capture the body
-- copy (date/time line, what to bring, etc.) — separate from the short
-- subtitle that sits under the title.

ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS institution_id INTEGER REFERENCES institutions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS description    TEXT,
  ADD COLUMN IF NOT EXISTS created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Partial index — the typical read is "events for institution X" so we
-- only index where institution_id IS NOT NULL to keep the index tiny.
CREATE INDEX IF NOT EXISTS idx_mobile_events_institution
  ON mobile_events (institution_id, event_date)
  WHERE institution_id IS NOT NULL;
