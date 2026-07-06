-- 040_events_payment_and_schedule.sql
--
-- Two Create-Event enhancements requested by the institution admin:
--
--   1. Payment-required flag + payment link. When an event has a paid
--      registration (e.g. Belt grading fee, tournament fee), the admin
--      turns the toggle on and pastes the payment link (Razorpay page,
--      external portal, whatever). Students/trainers then see a "Pay
--      Now" button on the event card instead of just "View".
--
--   2. Scheduled publishing. Previously an event was live the instant
--      the admin hit Publish. Now they can pick a future timestamp
--      (publish_at) and the event stays hidden from student/trainer
--      feeds until NOW() catches up. When publish_at IS NULL the event
--      is live immediately, so existing rows keep behaving exactly as
--      before — no data backfill needed.
--
-- Both columns are additive; the existing global CMS events and every
-- previously-created institution event default to payment_required=FALSE
-- and publish_at=NULL, which reproduces the old behaviour verbatim.

ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS payment_required BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payment_link     TEXT,
  ADD COLUMN IF NOT EXISTS publish_at       TIMESTAMPTZ;

-- Row-level sanity: if payment_required is on, payment_link cannot be
-- empty. Cheaper here than repeating the check in every insert path.
ALTER TABLE mobile_events
  DROP CONSTRAINT IF EXISTS mobile_events_payment_link_when_required;
ALTER TABLE mobile_events
  ADD CONSTRAINT mobile_events_payment_link_when_required
  CHECK (
    payment_required = FALSE
    OR (payment_link IS NOT NULL AND length(btrim(payment_link)) > 0)
  );

-- Read path filters (institution_id = X OR NULL) AND publish_at is either
-- null or already past. A partial index on rows still waiting to go live
-- lets a nightly / on-demand sweep find them cheaply if we ever add one.
CREATE INDEX IF NOT EXISTS idx_mobile_events_publish_at
  ON mobile_events (publish_at)
  WHERE publish_at IS NOT NULL;
