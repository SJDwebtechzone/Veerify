-- ============================================================================
-- 011_notifications.sql
-- ----------------------------------------------------------------------------
-- Per-user notifications inbox. Backs the Staff "Notifications" screen, the
-- student/parent app notification centers, and admin announcements.
--
-- Each row is a fan-out copy: when a trainer sends an announcement to a
-- batch, we INSERT one row per recipient. That's fine at this scale and
-- keeps reads (the unread badge + inbox list) trivially indexable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_id  INTEGER REFERENCES institutions(id) ON DELETE CASCADE,
  -- One of: class_cancelled, leave, attendance, announcement, emergency, system
  category        VARCHAR(30) NOT NULL DEFAULT 'system',
  title           VARCHAR(200) NOT NULL,
  message         TEXT,
  -- Optional structured payload — used for deep-linking from the notification
  -- card (e.g. { "screen": "StaffLeaveRequests", "id": 42 }).
  data            JSONB DEFAULT '{}'::jsonb,
  -- Read state. NULL = unread; a timestamp = the moment the user opened it.
  read_at         TIMESTAMP,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_all
  ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_category
  ON notifications (category);
