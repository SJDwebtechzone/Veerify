-- 097_event_interests.sql
--
-- Backs the "Are you interested to participate?" question on the
-- student-facing Event Details screen. One row per (event, student)
-- pair; the row's `interested` boolean is the student's latest
-- answer. UPSERT on the natural key so a student can flip Yes/No
-- freely without leaving history duplicates behind.
--
-- The institution's Select Students screen joins this table to
-- highlight students who tapped "Yes" for a given event so the
-- admin sees at a glance who explicitly asked to participate.

CREATE TABLE IF NOT EXISTS event_interests (
  id          SERIAL PRIMARY KEY,
  event_id    INTEGER NOT NULL REFERENCES mobile_events(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  interested  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, student_id)
);

-- Fast lookup for the /eligible-students join and the student's
-- own read-back on the Event Details screen.
CREATE INDEX IF NOT EXISTS idx_event_interests_event
  ON event_interests (event_id);
CREATE INDEX IF NOT EXISTS idx_event_interests_student
  ON event_interests (student_id);
