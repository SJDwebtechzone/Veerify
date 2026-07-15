-- 061_institutions_billing_term.sql
--
-- Persist the billing cycle the institution admin picked at plan
-- selection. Used downstream by the payment-link creation step so
-- the Razorpay amount matches whatever they chose on the plan card
-- (monthly / quarterly / half_yearly / annual).
--
-- Nullable — legacy institutions won't have this set; the payment
-- flow falls back to the plan's singleton `billing_cycle` when it's
-- missing, so nothing breaks for existing rows.

BEGIN;

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS selected_billing_term TEXT
    CHECK (selected_billing_term IN ('monthly','quarterly','half_yearly','annual'));

COMMIT;
