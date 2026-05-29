-- ============================================================================
-- 013_users_soft_delete.sql
-- ----------------------------------------------------------------------------
-- The auth controller's login + register flows reference `users.is_deleted`,
-- `deleted_at`, `deleted_by` but no migration ever added those columns. As
-- a result Postgres throws "column does not exist" on every login and on
-- the "restore deleted account" branch of register.
--
-- Add the columns with safe defaults so the existing code paths work:
--   is_deleted   BOOLEAN, default FALSE
--   deleted_at   TIMESTAMPTZ, NULL
--   deleted_by   INTEGER FK users(id), NULL on delete set null
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_alive
  ON users (id)
  WHERE is_deleted = FALSE;
