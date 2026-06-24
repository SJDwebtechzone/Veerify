-- ============================================================================
-- 035_branches_as_institutions.sql
-- ----------------------------------------------------------------------------
-- Branches are promoted to first-class institutions so a branch admin can
-- log in and operate independently — their own students, trainers,
-- courses, batches, dashboard — exactly like a standalone academy.
--
-- Design:
--   • Each branch becomes its own row in `institutions`.
--   • `parent_institution_id` points back to the head-office row.
--   • The head office has parent_institution_id = NULL.
--   • Child institutions inherit plan_id and lifecycle (paid_at,
--     subscription_end, onboarding_status='active') from the parent,
--     so the subscription guard, plan caps, and trial logic just work.
--   • Children get their own `owner_user_id` (a fresh admin user with
--     auto-generated credentials emailed to the branch).
--
-- Why this beats a separate branch_admin role:
--   • Zero refactor on every "WHERE institution_id = X" query already
--     scattered across students/trainers/courses/batches/announcements.
--   • Existing JWT scoping (institution_id baked into the token) keeps
--     each branch admin properly isolated to their own data.
--   • The head admin can still see aggregated data later via a single
--     `WHERE id IN (SELECT id FROM institutions WHERE parent_id = ?)`.
-- ============================================================================

BEGIN;

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS parent_institution_id INTEGER
  REFERENCES institutions(id) ON DELETE SET NULL;

-- Helpful for the head office to list its branches.
CREATE INDEX IF NOT EXISTS idx_institutions_parent
  ON institutions (parent_institution_id)
  WHERE parent_institution_id IS NOT NULL;

COMMIT;
