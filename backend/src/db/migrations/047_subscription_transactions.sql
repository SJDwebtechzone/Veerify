-- 047_subscription_transactions.sql
--
-- Every renew / upgrade / downgrade / onboarding payment attempt is
-- recorded here so the institution admin can see a full history under
-- Pricing & Plans → Payment History, and finance can reconcile against
-- Razorpay's dashboard.
--
-- One row per Razorpay Payment Link the backend mints. status flips to
-- 'paid' when the webhook confirms, 'failed' when Razorpay reports a
-- failure, and 'cancelled' when the admin walks away before paying.
--
-- action captures WHAT the payment is for:
--   • 'onboarding'    → the initial "select plan → pay → go live" flow
--   • 'renew'         → same plan, extends the subscription window
--   • 'change_plan'   → switch to a different plan (upgrade OR downgrade)

CREATE TABLE IF NOT EXISTS subscription_transactions (
  id                    SERIAL PRIMARY KEY,
  institution_id        INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  plan_id               INTEGER REFERENCES subscription_plans(id) ON DELETE SET NULL,
  plan_name_snapshot    TEXT,        -- captured at mint time; survives plan renames
  action                TEXT NOT NULL
                          CHECK (action IN ('onboarding', 'renew', 'change_plan')),
  previous_plan_id      INTEGER REFERENCES subscription_plans(id) ON DELETE SET NULL,

  -- Money on the wire is always paise; base_paise before wallet /
  -- referral discount, amount_paise after.
  base_paise            INTEGER NOT NULL CHECK (base_paise >= 0),
  referral_discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (referral_discount_paise >= 0),
  amount_paise          INTEGER NOT NULL CHECK (amount_paise >= 0),

  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),

  razorpay_link_id      TEXT UNIQUE,
  razorpay_short_url    TEXT,
  razorpay_payment_id   TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at               TIMESTAMPTZ,

  -- Post-payment snapshot so the history row still reflects what the
  -- subscription looked like RIGHT AFTER this transaction, even if the
  -- plan / caps get changed later.
  new_subscription_end  TIMESTAMPTZ
);

-- Hot read path — "list this institution's history newest first".
CREATE INDEX IF NOT EXISTS idx_subscription_transactions_inst
  ON subscription_transactions (institution_id, created_at DESC);
