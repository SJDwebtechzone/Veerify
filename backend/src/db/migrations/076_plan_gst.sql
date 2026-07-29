-- 076_plan_gst.sql
--
-- GST support across the subscription module.
--
--   • subscription_plans.gst_percent — plan-level default GST rate.
--     Super-admin editable via Web Admin → Settings → Plans. Defaults
--     to 18.00 (India's standard SaaS GST slab).
--
--   • plan_pricing.gst_percent — per-billing-term rate snapshot.
--     Defaults to the parent plan's gst_percent when a new term row
--     is inserted; kept per-row so future changes to the plan default
--     don't rewrite historical rate on already-priced terms.
--
-- Base price stays in `price` (both tables). GST amount and total
-- payable are computed on read (see attachPricing in
-- plan.controller.js) — we deliberately DON'T store total_payable so
-- a rate correction only changes the derived total on new fetches
-- without touching historical invoice snapshots.
--
-- Invoices captured pre-migration keep their pre-GST amount as-is;
-- the invoice controller stamps the gst_percent used at issue time on
-- each row so historical pricing is preserved even if the plan's
-- default shifts.

BEGIN;

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5,2) NOT NULL DEFAULT 18.00;

ALTER TABLE plan_pricing
  ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5,2) NOT NULL DEFAULT 18.00;

-- Range guard: 0–50 covers every plausible SaaS GST scenario without
-- letting a stray 100 sneak in and double-charge customers.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_gst_pct_range') THEN
    ALTER TABLE subscription_plans
      ADD CONSTRAINT subscription_plans_gst_pct_range
      CHECK (gst_percent >= 0 AND gst_percent <= 50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_pricing_gst_pct_range') THEN
    ALTER TABLE plan_pricing
      ADD CONSTRAINT plan_pricing_gst_pct_range
      CHECK (gst_percent >= 0 AND gst_percent <= 50);
  END IF;
END $$;

COMMIT;
