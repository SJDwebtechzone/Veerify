-- Migration 002: payment tracking for institution onboarding.
-- Adds columns to track a Razorpay Payment Link created when an admin approves
-- an institution, and the actual payment record once the link is paid.
--
-- Run once against your Postgres database:
--   psql $DATABASE_URL -f src/db/migrations/002_add_payment_columns.sql
--
-- Safe to re-run: every ALTER uses IF NOT EXISTS.

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS payment_link_id      VARCHAR(64),
  ADD COLUMN IF NOT EXISTS payment_link_url     VARCHAR(500),
  ADD COLUMN IF NOT EXISTS payment_link_status  VARCHAR(20) DEFAULT 'pending'
    CHECK (payment_link_status IN ('pending', 'paid', 'expired', 'cancelled')),
  ADD COLUMN IF NOT EXISTS payment_amount       INTEGER,        -- amount in paise (₹ × 100)
  ADD COLUMN IF NOT EXISTS payment_reference    VARCHAR(64),    -- Razorpay pay_xxx id after success
  ADD COLUMN IF NOT EXISTS paid_at              TIMESTAMP;

-- Speed up webhook lookups: given a payment_link.paid event we look the row up
-- by payment_link_id.
CREATE INDEX IF NOT EXISTS idx_institutions_payment_link_id
  ON institutions (payment_link_id);
