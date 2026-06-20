-- Migration 029 — trainer notification approvals
--
-- When a trainer composes a notification, the institution admin must
-- review and approve it before it's fanned out to students. Admins
-- still send directly without approval — only the trainer flow goes
-- through this gate.
--
-- A `pending_announcements` row is the draft. On approval, the existing
-- /notifications/announce code runs to insert the actual rows into
-- `notifications`. On rejection, the row sits with status='rejected'
-- and a reason so the trainer can iterate.

CREATE TABLE IF NOT EXISTS pending_announcements (
  id                  SERIAL PRIMARY KEY,
  sender_id           INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_id      INTEGER       REFERENCES institutions(id) ON DELETE CASCADE,
  -- Audience targeting (mirrors the existing announce payload).
  audience            TEXT          NOT NULL DEFAULT 'batch',  -- 'batch' | 'institution'
  batch_id            INTEGER       REFERENCES batches(id) ON DELETE CASCADE,
  -- Notification content.
  title               TEXT          NOT NULL,
  message             TEXT,
  category            TEXT          DEFAULT 'announcement',
  data                JSONB         DEFAULT '{}'::jsonb,
  -- Lifecycle.
  status              TEXT          NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  reviewed_by         INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Fast lookup of an institution's pending queue (admin review screen).
CREATE INDEX IF NOT EXISTS idx_pending_announcements_institution_status
  ON pending_announcements (institution_id, status, created_at DESC);

-- Fast lookup of a trainer's own submitted queue.
CREATE INDEX IF NOT EXISTS idx_pending_announcements_sender
  ON pending_announcements (sender_id, created_at DESC);
