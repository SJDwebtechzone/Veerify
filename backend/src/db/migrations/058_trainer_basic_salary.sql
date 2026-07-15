-- 058_trainer_basic_salary.sql
--
-- Adds a per-trainer Basic Salary to the trainers profile row. The
-- institution admin sets it once on the Trainer create/edit form; it
-- becomes the read-only default that fills into every monthly Salary
-- slip on Institution → More → Salary. Each monthly slip continues to
-- carry its own base_amount on trainer_salaries so historical corrections
-- to the trainer's base don't rewrite past months.

BEGIN;

ALTER TABLE trainers
  ADD COLUMN IF NOT EXISTS basic_salary NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMIT;
