-- 070_trial_reminder.sql
--
-- Adds idempotency + performance columns for the "3 days before trial
-- ends" reminder email.
--
--   trial_reminder_sent_at  — timestamp of the ONE reminder email that
--                              was sent 3 days before trial expiry.
--                              NULL when no reminder has been sent yet.
--                              The scheduler filters on this so a
--                              single institution can never receive
--                              two reminder emails (per spec).
--
-- The hourly scheduler ranges on trial_ends_at ASC to find candidates,
-- so a partial index on active-trial rows keeps the scan cheap.

BEGIN;

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS trial_reminder_sent_at TIMESTAMPTZ;

-- Partial index: rows still in trial and not yet reminded. That's the
-- exact predicate the scheduler runs, so the planner can hit only the
-- handful of candidate rows instead of the whole table.
CREATE INDEX IF NOT EXISTS idx_institutions_trial_reminder_pending
  ON institutions (trial_ends_at)
  WHERE trial_ends_at IS NOT NULL
    AND paid_at IS NULL
    AND trial_reminder_sent_at IS NULL;

COMMIT;
