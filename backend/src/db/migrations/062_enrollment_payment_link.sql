-- 062_enrollment_payment_link.sql
--
-- Extends enrollments with the "Enable Payment Link" workflow the
-- institution / branch admin uses when adding a student:
--
--   • payment_link_enabled — TRUE when the admin picked "Enable
--     Payment Link" on Add Student. Distinguishes wallet-credit
--     (paid via the Razorpay link) from revenue-only (offline
--     payment_mode = cash/upi/bank/cheque) at reporting time.
--
--   • payment_link_url — the Razorpay short_url we minted. Stored so
--     the admin can copy / resend without re-hitting the API.
--
--   • payment_link_sent_at — timestamps the last successful email so
--     the resend flow can debounce accidental double-taps.
--
--   • revenue_channel — one of 'wallet' | 'revenue'. Set to 'wallet'
--     when the enrolment was paid via Razorpay link (needs later
--     credit to the institution/branch wallet after platform +
--     gateway deductions), or 'revenue' when the admin recorded an
--     offline payment_mode (money never touched the platform, so it
--     belongs to Institution/Branch Revenue only, not the wallet).

BEGIN;

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS payment_link_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payment_link_url     TEXT,
  ADD COLUMN IF NOT EXISTS payment_link_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revenue_channel      TEXT
    CHECK (revenue_channel IN ('wallet', 'revenue'));

CREATE INDEX IF NOT EXISTS idx_enrollments_revenue_channel
  ON enrollments (institution_id, revenue_channel)
  WHERE revenue_channel IS NOT NULL;

COMMIT;
