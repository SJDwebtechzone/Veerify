-- 042_event_branch_approval.sql
--
-- Branch → Parent event approval flow.
--
-- Institution admins have always been able to create events for their own
-- academy directly. Now that sub-branches also have their own admin login
-- and can create events too, the parent needs a moderation step: any
-- event created by a sub-branch admin is inserted with
-- approval_status = 'pending' and stays hidden from student/trainer feeds
-- until the parent institution's admin approves it.
--
-- Design points:
--   • Default = 'approved' so every existing row and every event created
--     by a main-branch admin keeps its old behaviour — no data backfill
--     required, no notification storm on migration.
--   • CHECK constraint enumerates the three legal values.
--   • approval_reason lets the parent give the branch a short explanation
--     when they reject. Sub-branch admin sees it on their EventsList row.
--   • approval_decided_by / approval_decided_at capture "who decided when"
--     for a simple audit trail — surface these later if we build an
--     approval log screen.

ALTER TABLE mobile_events
  ADD COLUMN IF NOT EXISTS approval_status     TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approval_reason     TEXT,
  ADD COLUMN IF NOT EXISTS approval_decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_decided_at TIMESTAMPTZ;

ALTER TABLE mobile_events
  DROP CONSTRAINT IF EXISTS mobile_events_approval_status_check;
ALTER TABLE mobile_events
  ADD CONSTRAINT mobile_events_approval_status_check
  CHECK (approval_status IN ('approved', 'pending', 'rejected'));

-- Hot read path: student / trainer feed queries filter
-- approval_status = 'approved' AND publish_at rules AND event_date rules.
-- A partial index on 'pending' keeps the parent-admin "pending approvals"
-- lookup fast even as approved rows accumulate.
CREATE INDEX IF NOT EXISTS idx_mobile_events_pending_by_institution
  ON mobile_events (institution_id)
  WHERE approval_status = 'pending';
