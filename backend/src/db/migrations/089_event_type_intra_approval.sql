-- 089_event_type_intra_approval.sql
--
-- Introduces the Inter-Level / Intra-Level event distinction on
-- mobile_events, plus the super-admin approval trail for Intra-Level
-- events. Idempotent — safe to re-run.
--
-- Semantics:
--   event_type = 'inter'  → institution-local event (existing flow).
--                           Visible only to the creating institution's
--                           students/trainers. Publishes immediately
--                           (approval_status = 'approved') for a main-
--                           branch admin; sub-branch admins still land
--                           on approval_status = 'pending' waiting for
--                           the parent institution admin.
--
--   event_type = 'intra'  → cross-institution event that needs the
--                           super-admin (web) to approve before it
--                           becomes visible. On create we always set
--                           approval_status = 'pending'. On super-admin
--                           approval it flips to 'approved' and is
--                           promoted to every institution's feed via
--                           an OR-in on the read query.
--                           On reject it flips to 'rejected' and stays
--                           hidden from every feed.
--
-- The extra tracking columns (submitted_at / rejected_at / rejected_by)
-- give the approval queue enough history to render "submitted on" and
-- audit who rejected what. approved_at / approved_by already exist on
-- mobile_events for the sub-branch approval flow, so we reuse them
-- for the intra-approval trail — no schema duplication.

ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS event_type    VARCHAR(10) NOT NULL DEFAULT 'inter';

ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS submitted_at  TIMESTAMPTZ;

-- Approval trail. The controller assumed approved_at / approved_by
-- already existed on mobile_events (they used to be added by an
-- earlier branch-approval migration on some environments) — we add
-- them here so this migration is self-contained on any DB.
ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ;

ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS approved_by   INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS rejected_at   TIMESTAMPTZ;

ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS rejected_by   INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Constrain the vocabulary so a typo can never sneak an unknown
-- event_type into the table. Wrapped in DO block so re-runs don't
-- error on the pre-existing constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mobile_events_event_type_chk'
  ) THEN
    ALTER TABLE mobile_events
      ADD CONSTRAINT mobile_events_event_type_chk
      CHECK (event_type IN ('inter', 'intra'));
  END IF;
END $$;

-- Composite index for the two hot read paths:
--   1. Institution feed: (institution_id, event_type, approval_status)
--   2. Super-admin approval queue: (event_type, approval_status)
CREATE INDEX IF NOT EXISTS mobile_events_type_status_inst_idx
  ON mobile_events (event_type, approval_status, institution_id);

-- Back-fill submitted_at on any historical rows so the approval-queue
-- UI has a real timestamp to show even for events that pre-date this
-- migration (falls back to created_at if the column exists).
UPDATE mobile_events
   SET submitted_at = COALESCE(submitted_at, created_at)
 WHERE submitted_at IS NULL
   AND event_type = 'intra';
