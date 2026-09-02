-- 090_event_registration_form.sql
--
-- MODULE 1: Event Registration Form Builder.
--
-- Adds a dynamic per-event registration-form definition so the
-- organizing institution can decide, per event, WHICH information
-- participating institutions must provide when they later register
-- students. This migration ONLY creates the storage — the actual
-- registration submission flow (Module 2) is NOT implemented here.
--
-- Storage:
--   mobile_events.registration_enabled  BOOLEAN
--     Master switch. When false, participating institutions never
--     see a registration flow for this event. Legacy events default
--     to false so nothing changes for the existing catalogue.
--
--   event_registration_fields
--     One row per field definition attached to a given event. A
--     single row can either REFERENCE a canonical student profile
--     field (source_type='student', source_key='name'|'phone'|...)
--     — i.e. "the participating institution supplies the student's
--     name at registration" — OR it can be a fully custom field
--     (source_type='custom') created by the organizer.
--
--   Options for dropdown / radio / checkbox live in the JSONB
--   `options` column as an ordered array of {label, value} objects.
--   NULL for field types that don't take options.
--
-- Idempotent — safe to re-run.

ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS registration_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS event_registration_fields (
  id            SERIAL       PRIMARY KEY,
  event_id      INTEGER      NOT NULL REFERENCES mobile_events(id) ON DELETE CASCADE,
  field_key     VARCHAR(80)  NOT NULL,
  field_label   VARCHAR(200) NOT NULL,
  -- text | number | date | dropdown | radio | checkbox | textarea | file
  -- (custom rows) OR student  (student-profile reference rows).
  field_type    VARCHAR(20)  NOT NULL,
  required      BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Ordered array of { label, value } objects for enum-style
  -- field types (dropdown / radio / checkbox). NULL for others.
  options       JSONB,
  -- 'student' — reference to an existing student profile column;
  -- source_key is the canonical column name (name, dob, gender,
  -- phone, email, belt_level, course, institution, branch).
  -- 'custom' — brand-new field defined by the organizer.
  source_type   VARCHAR(10)  NOT NULL DEFAULT 'custom',
  source_key    VARCHAR(80),
  sort_order    INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT event_registration_fields_source_chk
    CHECK (source_type IN ('student', 'custom')),
  CONSTRAINT event_registration_fields_type_chk
    CHECK (field_type IN (
      'student', 'text', 'number', 'date',
      'dropdown', 'radio', 'checkbox', 'textarea', 'file'
    ))
);

-- Uniqueness: no two field definitions for the same event may share
-- a field_key. Prevents accidental duplicates when the organizer
-- re-toggles a default field or when a client re-sends the same
-- custom field twice. field_key is normalised on write (lower-case,
-- snake_case slug of the label) so the constraint catches label
-- collisions too.
CREATE UNIQUE INDEX IF NOT EXISTS event_registration_fields_event_key_uk
  ON event_registration_fields (event_id, field_key);

CREATE INDEX IF NOT EXISTS event_registration_fields_event_sort_idx
  ON event_registration_fields (event_id, sort_order);
