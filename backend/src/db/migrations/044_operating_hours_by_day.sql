-- 044_operating_hours_by_day.sql
--
-- Per-day open/close times, driven by the new "Operating Hours" section
-- on the Academy Profile screen. The wizard's existing
-- operating_hours_weekday / operating_hours_weekend JSONB columns are
-- kept as-is for backwards compat with the SetupInstitutionScreen.
--
-- Shape stored on operating_hours_by_day (JSONB):
--
--   {
--     "mon": { "open": "09:00", "close": "18:00" },
--     "tue": { "open": "09:00", "close": "18:00" },
--     "wed": null,                                   ← closed
--     ...
--     "sun": null
--   }
--
-- Days keyed lowercase 3-letter — Postgres doesn't care but this keeps
-- the JSON compact on the wire.

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS operating_hours_by_day JSONB;
