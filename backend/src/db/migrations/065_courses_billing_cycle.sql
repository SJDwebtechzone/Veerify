-- 065_courses_billing_cycle.sql
--
-- Adds a `billing_cycle` column to courses so the admin can declare
-- HOW the course fee is billed. Every code path that displays the
-- fee label — student payment summary, Razorpay Payment Link
-- description, invoice PDF — reads this same column so the wording
-- is consistent everywhere.
--
-- Values match the subscription plans convention (which is also what
-- the events + subscription tables already use):
--
--   one_time    → "One-Time Fee"    — single upfront charge
--   monthly     → "Monthly Fee"     — default, current behaviour
--   quarterly   → "Quarterly Fee"   — every 3 months
--   half_yearly → "Half-Yearly Fee" — every 6 months
--   annual      → "Annual Fee"      — once per year
--
-- Default is 'monthly' so every existing course continues to bill the
-- same way it did before the migration.
BEGIN;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT
    DEFAULT 'monthly'
    CHECK (billing_cycle IN (
      'one_time', 'monthly', 'quarterly', 'half_yearly', 'annual'
    ));

-- Backfill any pre-existing rows that predate the default. NULLs are
-- treated as 'monthly' to preserve existing behaviour.
UPDATE courses
   SET billing_cycle = 'monthly'
 WHERE billing_cycle IS NULL;

COMMIT;
