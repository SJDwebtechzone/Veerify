-- 052_attendance_audit.sql
--
-- Extends the attendance table with an audit trail so the mobile can
-- surface "originally marked by <name> (<role>) · last updated by
-- <name> (<role>) · <date/time>" whenever a Trainer edits a Branch
-- Admin's mark, or vice versa.
--
-- Two changes:
--   1. Add `created_by` (immutable — the original marker), `updated_by`
--      (the last person to touch the row), and `updated_at` to
--      attendance itself. Backfill from the legacy `marked_by` +
--      `created_at` so old rows still render sensibly.
--   2. Create `attendance_history` — a full log of every create /
--      update. One row per action, kept forever. Cascades on delete
--      so removing an attendance record cleans its history.

BEGIN;

-- ── Attendance table: creator / updater metadata ─────────────────────
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- Backfill legacy rows so the mobile always has a marker name to show.
-- The old `marked_by` column stored whichever user last touched the
-- row, so it's the closest proxy for both created_by and updated_by
-- until fresh writes overwrite them.
UPDATE attendance
   SET created_by = COALESCE(created_by, marked_by),
       updated_by = COALESCE(updated_by, marked_by),
       updated_at = COALESCE(updated_at, created_at);

-- ── attendance_history: full audit log ───────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_history (
  id              SERIAL PRIMARY KEY,
  attendance_id   INTEGER REFERENCES attendance(id) ON DELETE CASCADE,
  -- Denormalised keys so history queries don't need a join back to
  -- attendance (useful for "show me every attendance change I made").
  student_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id        INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  date            DATE    NOT NULL,
  -- 'create' when the row didn't exist before this action; 'update'
  -- when the row's status was changed by a subsequent write.
  action          VARCHAR(10) NOT NULL CHECK (action IN ('create', 'update')),
  previous_status VARCHAR(20),
  new_status      VARCHAR(20),
  actor_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Captured at write time so the audit stays truthful even if the
  -- actor's role changes later (a trainer promoted to branch admin
  -- shouldn't have their old writes retroactively re-labelled).
  actor_role      VARCHAR(20),
  at              TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Hot read path: newest-first history for a given attendance row.
CREATE INDEX IF NOT EXISTS idx_attendance_history_attendance
  ON attendance_history (attendance_id, at DESC);

-- Support "who edited attendance today" reports.
CREATE INDEX IF NOT EXISTS idx_attendance_history_actor_date
  ON attendance_history (actor_id, at DESC);

COMMIT;
