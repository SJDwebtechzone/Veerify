-- 079_enrollment_credentials_wa.sql
--
-- Duplicate-send guard for the "student login credentials over
-- WhatsApp" flow.
--
-- Spec (Enroll → send WhatsApp credentials): "Ensure duplicate
-- WhatsApp messages are not sent for the same enrollment." Each
-- enrolment therefore carries a `credentials_wa_sent_at` timestamp
-- that gets stamped on the FIRST successful delivery.
--
-- Every dispatch site (offline admin enrol, activate-after-payment
-- webhook, admin resend) reads this column BEFORE calling the
-- WhatsApp API and skips silently when it's already set. An admin
-- resend intentionally re-sends by clearing the stamp inline before
-- calling — so this is a "one-shot per enrolment unless an operator
-- explicitly asks for another".
--
-- The stamp is per enrolment (not per user) so a student who joins a
-- second course under the same academy still gets their fresh
-- credentials WhatsApp for that new enrolment.

BEGIN;

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS credentials_wa_sent_at TIMESTAMPTZ;

-- Sparse — only enrolments that have delivered a WhatsApp message
-- ever populate the column. Useful for support queries like "when
-- did we last send credentials to this enrolment?".
CREATE INDEX IF NOT EXISTS idx_enrollments_credentials_wa_sent
  ON enrollments (credentials_wa_sent_at)
  WHERE credentials_wa_sent_at IS NOT NULL;

COMMIT;
