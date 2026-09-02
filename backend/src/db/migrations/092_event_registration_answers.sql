-- 092_event_registration_answers.sql
--
-- MODULE 3: Event Registration Form submissions.
--
-- Stores one row per (registration, field) pair — the actual
-- answers each participating institution supplies for the
-- organizer's Registration Form (Module 1) when they register
-- their selected students (Module 2) for an event.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS event_registration_answers (
  id              SERIAL       PRIMARY KEY,
  registration_id INTEGER      NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
  -- Denormalised for hot organiser-roster reads.
  event_id        INTEGER      NOT NULL REFERENCES mobile_events(id)       ON DELETE CASCADE,
  -- Which form-field this answers. NULL is allowed for a
  -- future free-form answer flow that doesn't have a definition
  -- row, but every current answer references a live definition.
  field_id        INTEGER      REFERENCES event_registration_fields(id)    ON DELETE SET NULL,
  -- Cached at write-time so a later field rename / re-key doesn't
  -- lose historical context.
  field_key       VARCHAR(80)  NOT NULL,
  field_label     VARCHAR(200) NOT NULL,
  field_type      VARCHAR(20)  NOT NULL,
  -- Scalar answers land here (text / number / date / single-choice).
  -- All values stringified so the schema doesn't sprout per-type
  -- columns as new field types get added.
  value_text      TEXT,
  -- Multi-choice (checkbox) answers + file metadata land as JSONB
  -- so we don't have to invent a side table.
  value_json      JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Read paths:
--   1. Fetch every answer for one registration (organiser view).
--   2. Fetch every registration+answer for one event (export).
CREATE INDEX IF NOT EXISTS event_registration_answers_reg_idx
  ON event_registration_answers (registration_id);
CREATE INDEX IF NOT EXISTS event_registration_answers_event_idx
  ON event_registration_answers (event_id);
