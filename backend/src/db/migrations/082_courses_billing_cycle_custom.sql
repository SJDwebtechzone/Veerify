-- 082_courses_billing_cycle_custom.sql
--
-- Relaxes courses.billing_cycle constraint to allow custom and yearly billing cycles
-- (e.g. 'monthly', 'quarterly', 'half_yearly', 'yearly', 'annual', 'one_time', 'custom', etc.).

BEGIN;

ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_billing_cycle_check;

COMMIT;
