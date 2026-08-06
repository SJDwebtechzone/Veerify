-- 084_enrollments_next_payment_date.sql
--
-- Adds enrollments.next_payment_date — the date the student is
-- expected to pay the next installment of their course fee.
--
-- Ownership + editability rules (enforced in the controller):
--   • Only editable when the enrolment was set up with the offline
--     payment path (payment_link_enabled = FALSE). Payment-link
--     enrolments derive their next-due date from the Razorpay link
--     lifecycle, so the manual field is disabled on the form and
--     ignored server-side if the client somehow sends it.
--   • Populated by the institution / branch admin on the Add
--     Student form. Editable on the Edit Student form under the
--     same rule.
--   • Consumed by a future reminder job (WA + in-app bell) to nudge
--     the student N days before the date.
--
-- Nullable — existing rows read as NULL, which the reminder job
-- interprets as "no scheduled next payment, skip this row". No
-- backfill needed.
--
-- Idempotent — safe to re-run on a schema that's already been
-- migrated.

BEGIN;

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS next_payment_date DATE;

-- Partial index — the reminder job wants to scan "who's due in the
-- next N days" quickly. Predicate covers only the rows that could
-- fire (has a date, not link-driven).
CREATE INDEX IF NOT EXISTS idx_enrollments_next_payment_date
  ON enrollments (next_payment_date)
  WHERE next_payment_date IS NOT NULL
    AND COALESCE(payment_link_enabled, FALSE) = FALSE;

COMMIT;
