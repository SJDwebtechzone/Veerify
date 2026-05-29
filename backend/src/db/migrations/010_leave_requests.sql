-- ============================================================================
-- 010_leave_requests.sql
-- ----------------------------------------------------------------------------
-- Leave request workflow for the Staff module's "Leave Requests" screen.
--
-- A student (or their linked parent) submits a request with a date range and
-- reason. The trainer assigned to that student's batch reviews and either
-- approves or rejects it; the academy admin can also review.
--
-- On approval, attendance entries for the covered dates can be marked as
-- 'leave' (the attendance.status check already allows that via migration 009).
-- ============================================================================

CREATE TABLE IF NOT EXISTS leave_requests (
  id                SERIAL PRIMARY KEY,
  student_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Optional batch scope. NULL means "applies across all of the student's
  -- batches" (rare for now, but cheap to keep flexible).
  batch_id          INTEGER REFERENCES batches(id) ON DELETE CASCADE,
  institution_id    INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  reason            TEXT,
  status            VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by      INTEGER NOT NULL REFERENCES users(id), -- student or parent user id
  reviewed_by       INTEGER REFERENCES users(id),          -- trainer / admin user id
  reviewed_at       TIMESTAMP,
  review_note       TEXT,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date)
);

-- Hot path: trainer's "pending" queue and student's "my history" both want
-- to filter by status + scope cheaply.
CREATE INDEX IF NOT EXISTS idx_leave_requests_status      ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_student     ON leave_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_batch       ON leave_requests(batch_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_institution ON leave_requests(institution_id);
