-- 080_fcm_tokens.sql
--
-- Firebase Cloud Messaging device tokens, one row per (user, device).
-- A single user can carry multiple rows — one per phone / tablet they
-- log in on, both platforms — so the notification.service can fan a
-- single push out to every device the user still owns.
--
-- Housekeeping:
--   • token is UNIQUE across the whole table so a device migrating
--     between accounts overwrites the old row rather than duplicating.
--   • last_seen_at is bumped on every register / refresh so an idle
--     token can be pruned by a future cleanup job.
--   • Invalid / unregistered tokens (Firebase returns
--     `messaging/registration-token-not-registered`) are DELETEd by
--     notification.service on the failing send — no is_valid flag.

BEGIN;

CREATE TABLE IF NOT EXISTS fcm_tokens (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT    NOT NULL,
  platform      TEXT    NOT NULL DEFAULT 'unknown'
                CHECK (platform IN ('android', 'ios', 'web', 'unknown')),
  app_version   TEXT,
  device_id     TEXT,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user
  ON fcm_tokens (user_id);

COMMIT;
