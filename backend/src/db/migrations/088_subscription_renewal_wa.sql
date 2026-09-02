-- 088_subscription_renewal_wa.sql
--
-- Per-transaction dedup log for the "thanks for renewing" WhatsApp
-- confirmation. One row per (institution, payment_reference) — the
-- unique constraint prevents a second confirmation from firing if the
-- renewal payment is verified twice (webhook + self-heal race, retried
-- webhook, mobile Renew Now button poll, etc.).
--
-- Because the key includes payment_reference, a subsequent renewal
-- (which produces a NEW Razorpay payment id) yields a fresh key and
-- the confirmation fires again for that new transaction — matching
-- the spec's "once per successful renewal transaction" rule.
--
-- ON DELETE CASCADE cleans up when an academy is deleted.
CREATE TABLE IF NOT EXISTS subscription_renewal_wa (
  id                SERIAL      PRIMARY KEY,
  institution_id    INTEGER     NOT NULL
                     REFERENCES institutions(id) ON DELETE CASCADE,
  payment_reference TEXT        NOT NULL,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status            VARCHAR(20) NOT NULL DEFAULT 'sent'
                     CHECK (status IN ('sent', 'failed', 'skipped')),
  message_id        TEXT,
  reason            TEXT,
  UNIQUE (institution_id, payment_reference)
);

CREATE INDEX IF NOT EXISTS idx_sub_renewal_wa_inst
  ON subscription_renewal_wa (institution_id);
