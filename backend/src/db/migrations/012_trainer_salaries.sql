-- ============================================================================
-- 012_trainer_salaries.sql
-- ----------------------------------------------------------------------------
-- Trainer payroll. One row per (trainer, salary period).
--
-- The period is stored as a YYYY-MM string so it's trivial to filter monthly
-- payroll without juggling date ranges. base_amount + bonus - deductions =
-- net_amount; we keep net stored to avoid recomputing on every read.
--
-- status: pending | paid | failed | on_hold
-- ============================================================================

CREATE TABLE IF NOT EXISTS trainer_salaries (
  id                 SERIAL PRIMARY KEY,
  trainer_id         INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  institution_id     INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  -- 'YYYY-MM' (e.g. '2026-05'). One slip per trainer per period, enforced
  -- below by a UNIQUE constraint.
  period             VARCHAR(7) NOT NULL,
  base_amount        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  bonus              NUMERIC(12, 2) NOT NULL DEFAULT 0,
  deductions         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  net_amount         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'paid', 'failed', 'on_hold')),
  payment_method     VARCHAR(20),                       -- cash | bank | upi | cheque | other
  payment_reference  VARCHAR(120),                      -- UTR / cheque no / etc.
  paid_at            TIMESTAMP,
  notes              TEXT,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (trainer_id, period)
);

CREATE INDEX IF NOT EXISTS idx_trainer_salaries_trainer ON trainer_salaries (trainer_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_salaries_status  ON trainer_salaries (status);
