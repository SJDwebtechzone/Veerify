-- 087_subscription_expiry_wa_reminders.sql
--
-- Per-day dedup log for the "your subscription expires soon" WhatsApp
-- reminder scheduler. One row per (institution, expiry-date, days-
-- before) — so:
--
--   • The composite unique constraint prevents a second reminder from
--     firing on the same calendar day for the same subscription cycle.
--   • Because the key includes subscription_end AS A DATE, a renewal
--     (which moves subscription_end into the future) yields a fresh
--     key set and a new reminder cycle starts automatically. No manual
--     "reset" is needed anywhere in the renewal flow.
--   • Because the key includes days_before, all three reminders in a
--     single cycle (T-3, T-2, T-1) each get their own row and never
--     collide with one another.
--
-- ON DELETE CASCADE on institution_id auto-cleans deleted academies.
CREATE TABLE IF NOT EXISTS subscription_expiry_wa_reminders (
  id               SERIAL      PRIMARY KEY,
  institution_id   INTEGER     NOT NULL
                    REFERENCES institutions(id) ON DELETE CASCADE,
  subscription_end DATE        NOT NULL,
  days_before      SMALLINT    NOT NULL CHECK (days_before BETWEEN 0 AND 30),
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status           VARCHAR(20) NOT NULL DEFAULT 'sent'
                    CHECK (status IN ('sent', 'failed', 'skipped')),
  message_id       TEXT,
  reason           TEXT,
  UNIQUE (institution_id, subscription_end, days_before)
);

CREATE INDEX IF NOT EXISTS idx_sub_expiry_wa_inst_end
  ON subscription_expiry_wa_reminders (institution_id, subscription_end);
