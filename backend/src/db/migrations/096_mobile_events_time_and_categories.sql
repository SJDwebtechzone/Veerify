-- 096_mobile_events_time_and_categories.sql
--
-- FEATURE: back the mobile Event Creation form's new fields with
-- proper columns so the participant-side Registration Form can look
-- up the event's configured skills instead of only having whatever
-- the organiser passed at create time (previously the mobile POST
-- sent `event_time` + `categories` but the backend silently dropped
-- them).
--
--   • event_time   — optional start time of day, HH:MM 24h format.
--                    Stored as TEXT so a stray 'null'/empty string
--                    round-trip never trips a strict TIME cast.
--   • categories   — jsonb list of { name, skills: [{ name,
--                    age_from, age_to }] } authored during Event
--                    Creation → Categories & Skills. The Registration
--                    Form's Skills dropdown reads from here so its
--                    options are the single source of truth for the
--                    event, not a hardcoded list.
--
-- Idempotent — safe to re-run.
ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS event_time TEXT;

ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS categories JSONB NOT NULL DEFAULT '[]'::jsonb;
