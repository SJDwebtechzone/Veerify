-- 067_account_deletion_audit.sql
--
-- Audit trail for user-initiated account deletions. Every time a user
-- taps "Delete Account" and passes the password re-verification, a
-- row lands here BEFORE the users row is anonymised — so we always
-- have a permanent, tamper-evident record even after the identifying
-- data itself is scrubbed.
--
-- Retention: legal / financial records (enrolments, payments,
-- invoices, subscription_transactions) stay intact — the user row
-- is anonymised (name/email/phone replaced with tombstone values,
-- password cleared) rather than hard-deleted so those foreign-key
-- relationships continue to resolve. The `deleted_snapshot` column
-- keeps a small JSON copy of the user's identity at deletion time
-- (email, phone, role) so support can respond to "did I delete the
-- right account?" queries later without needing to keep the row
-- itself intact.
BEGIN;

CREATE TABLE IF NOT EXISTS account_deletion_audit (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL,            -- no FK — must survive user teardown
  role_snapshot      TEXT NOT NULL,               -- 'admin'|'student'|'trainer'|'parent'
  email_snapshot     TEXT,                        -- pre-deletion email
  phone_snapshot     TEXT,                        -- pre-deletion phone
  institution_id     INTEGER,                     -- if the user was linked to one
  deleted_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Where the deletion came from — 'user' (self-service via mobile),
  -- 'admin' (institution admin removing a student), or 'system'
  -- (automated retention purge; not used yet).
  initiated_by       TEXT NOT NULL DEFAULT 'user'
                     CHECK (initiated_by IN ('user','admin','system')),
  -- Optional JSON blob for anything else we want to record — the
  -- caller's IP + user-agent, reason text, etc. Kept nullable so
  -- lightweight audit rows still write cleanly.
  metadata           JSONB
);

CREATE INDEX IF NOT EXISTS idx_deletion_audit_user
  ON account_deletion_audit (user_id);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_when
  ON account_deletion_audit (deleted_at DESC);

COMMIT;
