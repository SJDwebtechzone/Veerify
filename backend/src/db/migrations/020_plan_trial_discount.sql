-- 020_plan_trial_discount.sql
--
-- Extends subscription_plans with the trial / grace / discount fields the
-- super admin Plans form now collects.
--
--   trial_days        - days the institution can use all features free
--                       after subscribing. Default 0 = no trial.
--   grace_days        - days after the trial expires during which the
--                       institution can still log in and pay before
--                       hard-locking access. Default 0 = no grace window.
--   discount_enabled  - master switch for the per-plan discount.
--   discount_percent  - 0-100. Only consulted when discount_enabled = true.
--                       Effective price = price * (1 - discount_percent/100).
--
-- Enforcement (gating login during trial/grace, applying discount in the
-- payment-link amount) lives outside this migration — this is just data.

BEGIN;

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS trial_days       INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grace_days       INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_enabled BOOLEAN       DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2)  DEFAULT 0;

-- Guard against silly values via constraints.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_trial_days_nonneg'
  ) THEN
    ALTER TABLE subscription_plans
      ADD CONSTRAINT subscription_plans_trial_days_nonneg
      CHECK (trial_days >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_grace_days_nonneg'
  ) THEN
    ALTER TABLE subscription_plans
      ADD CONSTRAINT subscription_plans_grace_days_nonneg
      CHECK (grace_days >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_discount_pct_range'
  ) THEN
    ALTER TABLE subscription_plans
      ADD CONSTRAINT subscription_plans_discount_pct_range
      CHECK (discount_percent >= 0 AND discount_percent <= 100);
  END IF;
END $$;

COMMIT;
