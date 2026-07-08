-- 053_subscription_txn_extras.sql
--
-- Fills in the fields the Web Admin → Payments → Subscription Payments
-- listing needs but that the original 047 migration didn't capture:
--
--   • billing_cycle    — what the payer chose at mint time (monthly /
--                        quarterly / half_yearly / annual). Different
--                        from the plan's own default; a plan can offer
--                        several terms via plan_pricing.
--   • payment_gateway  — every real payment today goes through Razorpay,
--                        but a future PSP would land here. Defaults so
--                        legacy rows read as 'razorpay' without a
--                        one-off update.
--   • auto_renewal     — Razorpay Payment Links are one-shots so this is
--                        FALSE for now, but the column exists so the UI
--                        can start rendering the flag before we wire the
--                        recurring-mandate flow.
--   • invoice_url      — Razorpay's hosted invoice PDF. Populated when
--                        the webhook payload carries `invoice_id`; the
--                        listing page shows a View / Download link when
--                        set and a "—" otherwise.
--   • branch_id        — For sub-branch scoped payments (rare — most
--                        subscriptions are at the root institution).
--                        Nullable so the UI can render "Main" when NULL.
--
-- Every column defaults so existing rows keep working without a manual
-- backfill.

BEGIN;

ALTER TABLE subscription_transactions
  ADD COLUMN IF NOT EXISTS billing_cycle    TEXT
    CHECK (billing_cycle IS NULL
           OR billing_cycle IN ('monthly','quarterly','half_yearly','annual')),
  ADD COLUMN IF NOT EXISTS payment_gateway  TEXT NOT NULL DEFAULT 'razorpay',
  ADD COLUMN IF NOT EXISTS auto_renewal     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invoice_url      TEXT,
  ADD COLUMN IF NOT EXISTS branch_id        INTEGER REFERENCES institutions(id) ON DELETE SET NULL;

-- Backfill billing_cycle for existing rows from the plan's legacy
-- billing_cycle column when known, otherwise leave NULL and let the UI
-- show "—".
UPDATE subscription_transactions t
   SET billing_cycle = COALESCE(
         t.billing_cycle,
         CASE sp.billing_cycle
           WHEN 'yearly' THEN 'annual'
           WHEN 'monthly' THEN 'monthly'
           WHEN 'quarterly' THEN 'quarterly'
           WHEN 'half_yearly' THEN 'half_yearly'
           WHEN 'annual' THEN 'annual'
           ELSE NULL
         END
       )
  FROM subscription_plans sp
 WHERE sp.id = t.plan_id
   AND t.billing_cycle IS NULL;

COMMIT;
