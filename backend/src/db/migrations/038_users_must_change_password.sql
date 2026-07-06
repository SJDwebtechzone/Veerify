-- ============================================================================
-- 038_users_must_change_password.sql
-- ----------------------------------------------------------------------------
-- Forced (but skippable) first-login password change for users whose
-- account was created by someone else with a temporary password —
-- typically sub-branch admins provisioned by setupAcademy /
-- provisionOrResendBranch.
--
-- The mobile login screen checks this flag in the /auth/login response
-- and pops a "Change password / I'll do it later" dialog when it is true.
-- /auth/change-password and /auth/forgot-password both clear it.
--
-- Existing users default to FALSE so we don't nag accounts that have
-- been around for a while.
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
