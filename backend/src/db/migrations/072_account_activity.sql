-- 072_account_activity.sql
--
-- Two tables backing the Web Admin → Account Settings feature:
--
--   • email_change_otps — one-per-user pending email-change record.
--     Holds the target new_email, a bcrypt hash of the 6-digit OTP,
--     an expires_at (10 min from creation per spec), a running
--     attempts counter for failed verifications, and a resend_count
--     for rate limiting resends. On successful verify the row is
--     stamped verified_at and the users.email column is updated.
--     One-per-user via a UNIQUE(user_id) — starting a fresh request
--     overwrites the previous one. See auth.controller.js for the
--     write path.
--
--   • account_activity_log — append-only audit trail of every
--     account-level change (email change, password change, and
--     future-proofed slots for MFA / device revoke). Written by
--     auth.controller after every successful mutation. The row
--     carries the actor's ip + user_agent for post-hoc forensics
--     and a jsonb metadata blob for action-specific detail (e.g.
--     old_email → new_email pair).

BEGIN;

CREATE TABLE IF NOT EXISTS email_change_otps (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email      TEXT NOT NULL,
  otp_hash       TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  resend_count   INTEGER NOT NULL DEFAULT 0,
  last_sent_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_email_change_otps_expires
  ON email_change_otps (expires_at)
  WHERE verified_at IS NULL;

CREATE TABLE IF NOT EXISTS account_activity_log (
  id             BIGSERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action         TEXT NOT NULL,   -- 'email_changed' | 'password_changed' | 'email_change_requested' | ...
  ip             TEXT,
  user_agent     TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_activity_log_user
  ON account_activity_log (user_id, created_at DESC);

COMMIT;
