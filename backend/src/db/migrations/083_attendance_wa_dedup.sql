-- 083_attendance_wa_dedup.sql
--
-- WhatsApp attendance-alert dedup stamps on attendance rows.
--
-- Product rule: when attendance is saved with a NON-'present' status
-- (absent / late / leave / holiday / …), we send a WhatsApp message
-- to the student's contact number. If the same status is re-saved
-- for the same (student, batch, date), we DO NOT send again — the
-- gate must survive a trainer re-tapping Save, a branch admin editing
-- a row, or a mobile retry after a network hiccup.
--
-- Two stamps land per row:
--   wa_sent_at     — TIMESTAMPTZ when the last WA fired.
--   wa_sent_status — snapshot of the status that was sent.
--
-- Send-time gate becomes:
--     new_status <> 'present'
--     AND (wa_sent_at IS NULL OR wa_sent_status IS DISTINCT FROM new_status)
--
-- Status transitions (absent → late, late → leave) count as NEW
-- events and DO trigger a fresh send — parents deserve to hear about
-- the corrected code, and the dedup only guards against re-sending
-- the SAME code twice.
--
-- Present marks never send, so we never stamp for them either.
--
-- Idempotent — safe to re-run on a schema that's already been
-- migrated. No backfill required; existing rows read as NULL / no
-- prior send, which is the correct default (they've already been
-- historically communicated through other channels).

BEGIN;

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS wa_sent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wa_sent_status VARCHAR(20);

COMMIT;
