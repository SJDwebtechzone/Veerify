-- 054_course_completions.sql
--
-- Tracks a student's journey from "finished the curriculum" → "passed
-- belt test with trainer remarks" → "certificate dispatched by admin".
--
-- Powers three surfaces:
--   1. Trainer Login → StaffStudentDetail: when the trainer ticks the
--      last curriculum lesson, the mobile pops "Course completed.
--      Proceed to Belt Test?" and INSERTs one row here on Yes.
--   2. Trainer Login → Quick Actions → Completed Students: lists every
--      row where trainer_id = caller. Trainer types Test Remarks and
--      saves; belt_test_completed_at auto-fills, status flips to
--      'awaiting_certificate'.
--   3. Institution Login → Certificates: lists rows with status
--      'awaiting_certificate'. Admin taps Send Certificate; status
--      flips to 'certificate_sent' and certificate_sent_at is stamped.
--
-- One row per (student, course) pair. Re-uploading the last curriculum
-- lesson (e.g. after an undo) reuses the existing row via the unique
-- index rather than piling up duplicates.

BEGIN;

CREATE TABLE IF NOT EXISTS course_completions (
  id                        SERIAL PRIMARY KEY,
  student_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id                 INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  batch_id                  INTEGER          REFERENCES batches(id) ON DELETE SET NULL,
  trainer_id                INTEGER          REFERENCES users(id) ON DELETE SET NULL,
  institution_id            INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,

  -- Timestamps stamped at each transition. All UTC.
  course_completed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  belt_test_completed_at    TIMESTAMPTZ,
  certificate_sent_at       TIMESTAMPTZ,

  -- Trainer-typed notes on the belt test. Only mutable field on the
  -- entire row for the trainer; the institution reads it but can't
  -- edit it (their edit surface is the "Send Certificate" action).
  test_remarks              TEXT,

  -- Workflow state:
  --   'awaiting_test'         → curriculum done, waiting for trainer
  --                             to record belt-test outcome.
  --   'awaiting_certificate'  → trainer submitted remarks; institution
  --                             admin still needs to dispatch.
  --   'certificate_sent'      → institution admin marked done. Terminal.
  status                    TEXT NOT NULL DEFAULT 'awaiting_test'
                              CHECK (status IN (
                                'awaiting_test',
                                'awaiting_certificate',
                                'certificate_sent'
                              )),

  -- Who dispatched the certificate — matches users(id) so we can
  -- surface "sent by <admin name>" on the audit line without a join.
  certificate_sent_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Optional link to certificates(id) once we auto-generate a PDF for
  -- this completion. Kept nullable so this migration can ship before
  -- the auto-generation flow lands.
  certificate_id            INTEGER REFERENCES certificates(id) ON DELETE SET NULL,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One completion row per (student, course). If the trainer un-ticks
-- the last lesson and re-ticks it, we UPSERT into the same row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_course_completions_student_course
  ON course_completions (student_id, course_id);

-- Fast reads for the trainer & institution listing endpoints.
CREATE INDEX IF NOT EXISTS idx_course_completions_trainer_status
  ON course_completions (trainer_id, status, course_completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_completions_institution_status
  ON course_completions (institution_id, status, course_completed_at DESC);

COMMIT;
