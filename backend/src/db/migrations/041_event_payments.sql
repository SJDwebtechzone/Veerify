-- 041_event_payments.sql
--
-- Revises 040. The Payment Required feature originally shipped as an
-- external URL that the admin pasted in; that turned into "same integrated
-- flow as subscription pay" (Razorpay Payment Link generated on demand
-- when the student/trainer taps Pay Now). Consequence:
--
--   • mobile_events.payment_link is no longer used → drop it (with its
--     CHECK constraint from 040). Nothing production has flowed through
--     that column yet since 040 was created in this same session.
--   • Add payment_amount (in rupees). Admin picks the fee at create time.
--   • CHECK: whenever payment_required is TRUE, payment_amount must be
--     positive. Symmetrical to what we did before but for the new column.
--   • New table event_payments — one row per (event, user) attempt, so
--     "Pay Now" can flip to "Paid" once the webhook confirms the charge,
--     and re-tap can reuse an open link instead of always minting new
--     ones.

-- ── 1. Drop the previous payment_link plumbing ─────────────────────────
ALTER TABLE mobile_events
  DROP CONSTRAINT IF EXISTS mobile_events_payment_link_when_required;

ALTER TABLE mobile_events
  DROP COLUMN IF EXISTS payment_link;

-- ── 2. Add the fee-amount column + its CHECK ──────────────────────────
ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(10,2);

ALTER TABLE mobile_events
  DROP CONSTRAINT IF EXISTS mobile_events_amount_when_required;
ALTER TABLE mobile_events
  ADD CONSTRAINT mobile_events_amount_when_required
  CHECK (
    payment_required = FALSE
    OR (payment_amount IS NOT NULL AND payment_amount > 0)
  );

-- ── 3. Per-user payment tracking ──────────────────────────────────────
-- We store one row per Razorpay Payment Link created. status starts as
-- 'pending' and flips to 'paid' from the Razorpay webhook once the user
-- actually completes checkout. A single (event, user) may generate a
-- new link if the previous one expired or was cancelled, so we key
-- uniqueness by razorpay_link_id — not by (event, user) alone.
CREATE TABLE IF NOT EXISTS event_payments (
  id                  SERIAL PRIMARY KEY,
  event_id            INTEGER NOT NULL REFERENCES mobile_events(id) ON DELETE CASCADE,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_paise        INTEGER NOT NULL CHECK (amount_paise > 0),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  razorpay_link_id    TEXT UNIQUE,
  razorpay_short_url  TEXT,
  razorpay_payment_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at             TIMESTAMPTZ
);

-- Hot read path: "has this user already paid for event X?" We short-
-- circuit by looking for a paid row on (event_id, user_id).
CREATE INDEX IF NOT EXISTS idx_event_payments_event_user_status
  ON event_payments (event_id, user_id, status);

-- Webhook lookup goes by razorpay_link_id (already covered by the UNIQUE
-- constraint's index) so no extra one needed there.
