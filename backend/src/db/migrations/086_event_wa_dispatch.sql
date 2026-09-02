-- 086_event_wa_dispatch.sql
--
-- Per-(event, student) audit + dedup log for the "new event" WhatsApp
-- fan-out. The event WA blast runs asynchronously after event creation
-- and is fanned out through this table so:
--
--   • The composite PK (event_id, user_id) prevents duplicate messages
--     for the same event / student even if the same fan-out is queued
--     twice (double-tap by admin, retry after crash, scheduler
--     re-processing a partially-completed run).
--   • A cheap read of "is this (event, user) already dispatched?" gates
--     each individual send.
--   • status + message_id let ops audit deliveries after the fact when
--     a student reports missing a WhatsApp.
--
-- ON DELETE CASCADE on both FKs keeps this table clean automatically —
-- deleting an event or a student wipes their dispatch rows.
CREATE TABLE IF NOT EXISTS event_wa_dispatch (
  event_id   INTEGER      NOT NULL REFERENCES mobile_events(id) ON DELETE CASCADE,
  user_id    INTEGER      NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  sent_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  status     VARCHAR(20)  NOT NULL DEFAULT 'sent'
              CHECK (status IN ('sent', 'failed', 'skipped')),
  message_id TEXT,
  reason     TEXT,
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_wa_dispatch_user ON event_wa_dispatch(user_id);
CREATE INDEX IF NOT EXISTS idx_event_wa_dispatch_event ON event_wa_dispatch(event_id);
