-- 091_event_registrations.sql
--
-- MODULE 2: Event → Select Students for Registration.
--
-- Minimal registration table so we can (a) enforce the duplicate-
-- registration rule (one row per event × student) and (b) surface
-- the already_registered flag on the Select Students screen. The
-- ACTUAL answers to the organizer's Registration Form live on the
-- next-module extension (event_registration_answers, coming in
-- MODULE 3) — this table only records "student X of institution Y
-- is registered for event Z, submitted at T".
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS event_registrations (
  id                     SERIAL      PRIMARY KEY,
  event_id               INTEGER     NOT NULL REFERENCES mobile_events(id) ON DELETE CASCADE,
  -- Students in this codebase are `users` rows with role='student'
  -- (student_profiles hangs off that user id). We reference users
  -- directly so a student soft- or hard-delete propagates cleanly.
  student_id             INTEGER     NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  -- The PARTICIPATING institution (i.e. the institution that owns
  -- the student). Kept denormalised so lookups + security checks
  -- avoid an extra join through the enrollments graph.
  institution_id         INTEGER     NOT NULL REFERENCES institutions(id)  ON DELETE CASCADE,
  -- The user who submitted the registration (institution admin
  -- performing the Select Students flow).
  submitted_by           INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  -- Lifecycle: 'registered' (default, created here) → later modules
  -- may add 'cancelled' / 'waitlisted' etc. Kept as VARCHAR so
  -- extending the vocabulary doesn't need a migration.
  status                 VARCHAR(20) NOT NULL DEFAULT 'registered',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Duplicate-registration guard. One row per event × student — even
-- if the client tries to POST the same student twice we're safe.
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_event_student_uk
  ON event_registrations (event_id, student_id);

-- Hot read paths:
--   1. "which of MY students are already registered for event X?"
--      → (event_id, institution_id) join with students table.
--   2. Organizer roster: "who is registered for my event?"
--      → (event_id) already covered by the unique index above.
CREATE INDEX IF NOT EXISTS event_registrations_event_inst_idx
  ON event_registrations (event_id, institution_id);
