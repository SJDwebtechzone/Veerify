-- 021_institution_trial_window.sql
--
-- Adds the trial / grace window columns to institutions so each academy can
-- track the lifecycle the super admin configured on its subscription_plan
-- (trial_days, grace_days).
--
--   trial_starts_at  - moment the trial countdown begins. Set when the super
--                      admin approves the institution.
--   trial_ends_at    - trial_starts_at + plan.trial_days.
--   grace_ends_at    - trial_ends_at + plan.grace_days. After this point the
--                      institution must have paid; otherwise it's "locked".
--
-- All three are NULL-friendly for legacy rows that were created before the
-- trial concept existed. Lifecycle phase is derived at read time:
--   paid_at IS NOT NULL                       -> 'paid'
--   trial_ends_at IS NULL                     -> 'pending'   (not approved yet)
--   NOW() <= trial_ends_at                    -> 'trial'
--   NOW() <= grace_ends_at                    -> 'grace'
--   else                                      -> 'locked'

BEGIN;

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS trial_starts_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_ends_at    TIMESTAMPTZ;

-- Indexed only on grace_ends_at because the only query that scans by these
-- is the "who is about to be locked out" reminder cron, which filters on
-- grace_ends_at near NOW().
CREATE INDEX IF NOT EXISTS idx_institutions_grace_ends_at
  ON institutions (grace_ends_at)
  WHERE grace_ends_at IS NOT NULL;

COMMIT;
