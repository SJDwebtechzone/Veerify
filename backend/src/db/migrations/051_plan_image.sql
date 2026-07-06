-- 051_plan_image.sql
--
-- Optional plan image, shown next to the plan name on both the admin
-- web plan list and the mobile PlanSelection / PricingPlans screens.
-- Nullable — plans without an uploaded image render a soft brand-tinted
-- placeholder card so nothing breaks visually.

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS image_url TEXT;
