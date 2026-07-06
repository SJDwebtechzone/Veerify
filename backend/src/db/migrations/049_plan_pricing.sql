-- 049_plan_pricing.sql
--
-- Per-billing-term pricing for each subscription plan. A plan can now
-- offer any subset of {monthly, quarterly, half_yearly, annual} at
-- different price points. The mobile shows a plan card and lets the
-- user pick a billing term at payment time.
--
-- Legacy columns subscription_plans.price + subscription_plans.billing_cycle
-- are KEPT and back-filled from the current row so every existing
-- consumer keeps rendering something sensible during the transition.
-- The admin web writes to plan_pricing on save; the backend derives
-- the legacy singleton columns from whichever term is enabled + priced
-- lowest (typically the "monthly" fallback).

CREATE TABLE IF NOT EXISTS plan_pricing (
  id           SERIAL PRIMARY KEY,
  plan_id      INTEGER NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  billing_term TEXT NOT NULL
                 CHECK (billing_term IN ('monthly','quarterly','half_yearly','annual')),
  price        NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  is_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, billing_term)
);

CREATE INDEX IF NOT EXISTS idx_plan_pricing_plan
  ON plan_pricing (plan_id, is_enabled);

-- Backfill: each existing plan gets a plan_pricing row for its current
-- billing_cycle at its current price, enabled by default. Plans without
-- a billing_cycle default to 'monthly'.
INSERT INTO plan_pricing (plan_id, billing_term, price, is_enabled)
SELECT
  id,
  CASE
    WHEN billing_cycle IN ('monthly','quarterly','half_yearly','annual') THEN billing_cycle
    WHEN billing_cycle = 'yearly' THEN 'annual'
    ELSE 'monthly'
  END,
  COALESCE(price, 0),
  TRUE
FROM subscription_plans
WHERE NOT EXISTS (
  SELECT 1 FROM plan_pricing pp WHERE pp.plan_id = subscription_plans.id
);
