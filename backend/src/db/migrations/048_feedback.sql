-- 048_feedback.sql
--
-- One-per-submission feedback ledger. Every login role (institution
-- admin, branch admin, student, trainer, parent) shares the same table
-- — we key by user_id + role snapshot so a role change later doesn't
-- rewrite history.
--
-- role_snapshot captures what the user WAS when they submitted feedback:
--   • 'institution_admin' — main-branch admin
--   • 'branch_admin'      — sub-branch admin (parent_institution_id set)
--   • 'trainer'
--   • 'student'
--   • 'parent'
--
-- rating: 1..5 (small integer, enforced by CHECK).
-- message: optional; NULL / '' both mean "no comment".
--
-- institution_id + branch_id are captured so the web admin can filter by
-- academy or specific branch. Both are nullable in case a role (super
-- admin, guest) has no institution attached.

CREATE TABLE IF NOT EXISTS feedback (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_snapshot   TEXT NOT NULL
                    CHECK (role_snapshot IN
                      ('institution_admin', 'branch_admin', 'trainer', 'student', 'parent')),
  institution_id  INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
  branch_id       INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
  rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  message         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot filters: role tab, star filter, date range.
CREATE INDEX IF NOT EXISTS idx_feedback_role_created
  ON feedback (role_snapshot, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_rating
  ON feedback (rating);
CREATE INDEX IF NOT EXISTS idx_feedback_created
  ON feedback (created_at DESC);
