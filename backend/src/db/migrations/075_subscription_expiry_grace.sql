-- 075_subscription_expiry_grace.sql
--
-- Post-expiry 3-day grace period for institution subscriptions.
--
-- Columns:
--   • subscription_status TEXT NOT NULL DEFAULT 'active'
--       Enum-like: 'active', 'expired', 'inactive'.
--         active   — paid + within the billing window.
--         expired  — past renewal date but inside the 3-day grace.
--                    Login stays allowed for institution / branch /
--                    trainer / student under this institution, but
--                    premium feature endpoints reject with 402.
--         inactive — past renewal + past grace. Login is BLOCKED
--                    for the four roles above; only super-admin
--                    stays authorised.
--       Renewal (paid_at refresh) flips back to 'active'.
--
--   • subscription_expired_at TIMESTAMPTZ
--       When the row first flipped to 'expired'. Used by the mobile
--       Pricing banner + the scheduler for the "N days remaining"
--       countdown so the banner shows 3 → 2 → 1.
--
-- Index:
--   • Partial index on subscription_status IN ('active','expired')
--     with paid_at so the hourly scanner can range on the (paid_at,
--     billing_cycle) window without a full-table scan.
--
-- Enforcement lives in application code — see:
--   • services/subscriptionExpiry.service.js (hourly scheduler)
--   • utils/subscriptionGuard.js             (feature gate)
--   • controllers/auth.controller.js login   (login gate)

BEGIN;

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS subscription_status     TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS subscription_expired_at TIMESTAMPTZ;

-- Constrain the enum values so a typo can't sneak past the app.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'institutions_subscription_status_enum'
  ) THEN
    ALTER TABLE institutions
      ADD CONSTRAINT institutions_subscription_status_enum
      CHECK (subscription_status IN ('active', 'expired', 'inactive'));
  END IF;
END $$;

-- Hot read: candidates for the expiry scan.
CREATE INDEX IF NOT EXISTS idx_institutions_subscription_scan
  ON institutions (subscription_status, paid_at)
  WHERE subscription_status IN ('active', 'expired');

COMMIT;
