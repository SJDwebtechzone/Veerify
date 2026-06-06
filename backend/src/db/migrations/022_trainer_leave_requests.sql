-- ============================================================================
-- 022_trainer_leave_requests.sql
-- ----------------------------------------------------------------------------
-- Trainer-from-work leave requests.
--
-- Distinct from leave_requests (which is the STUDENT-from-class flow). A
-- trainer submits a date range + reason, and the institution admin (the
-- owner of the academy) approves or rejects it. We keep them in a separate
-- table because:
--   - The actor is a trainer, not a student.
--   - The reviewer is the academy admin, not the student's batch trainer.
--   - No attendance-row side effect on approval (trainers don't have a
--     "student attendance" record to flip; their leave just affects which
--     batches need cover, which is out of scope for v1).
--
-- Workflow:
--   - Trainer  → POST /api/trainer-leave-requests       (create, status=pending)
--   - Trainer  → GET  /api/trainer-leave-requests/my    (own history)
--   - Admin    → GET  /api/trainer-leave-requests       (institution scope)
--   - Admin    → POST /api/trainer-leave-requests/:id/approve
--   - Admin    → POST /api/trainer-leave-requests/:id/reject
-- ============================================================================

CREATE TABLE IF NOT EXISTS trainer_leave_requests (
  id                SERIAL PRIMARY KEY,
  trainer_id        INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  institution_id    INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  reason            TEXT,
  status            VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  -- The user account that submitted the request. Usually the trainer's own
  -- user_id, but kept as a separate column so we don't have to JOIN through
  -- trainers every time we want "who clicked Submit".
  requested_by      INTEGER NOT NULL REFERENCES users(id),
  reviewed_by       INTEGER REFERENCES users(id),          -- admin user id
  reviewed_at       TIMESTAMP,
  review_note       TEXT,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date)
);

-- Hot paths: admin's "pending queue" by institution, trainer's "my history".
CREATE INDEX IF NOT EXISTS idx_trainer_leave_requests_institution
  ON trainer_leave_requests(institution_id);
CREATE INDEX IF NOT EXISTS idx_trainer_leave_requests_trainer
  ON trainer_leave_requests(trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_leave_requests_status
  ON trainer_leave_requests(status);
