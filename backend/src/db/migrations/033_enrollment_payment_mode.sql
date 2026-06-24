-- 033_enrollment_payment_mode.sql
--
-- Adds payment_mode to enrollments so admin-driven enrolments can record
-- how the institution actually collected the fee at the counter — Cash,
-- UPI, Bank Transfer or Cheque. Self-enrolled students leave it NULL and
-- still flow through the Razorpay / mock-pay path that writes only
-- payment_reference (no offline mode applies there).
--
-- Allowed values are validated by the controller; we keep the column as
-- a free VARCHAR rather than an enum so future modes (e.g. 'card_swipe',
-- 'wallet_credit') can be added without another migration.

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20);

-- Helpful index for admin reporting ("how much did we collect in Cash
-- this month?") — partial so the index stays tiny on the typical case
-- where most rows are NULL.
CREATE INDEX IF NOT EXISTS idx_enrollments_payment_mode
  ON enrollments (payment_mode)
  WHERE payment_mode IS NOT NULL;
