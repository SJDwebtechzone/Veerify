-- ============================================================================
-- 023_institution_payouts.sql
-- ----------------------------------------------------------------------------
-- Super-admin → institution settlement ledger.
--
-- The institution earns money when students pay for course enrolments
-- (enrollments.payment_status='paid' + payment_amount). The platform takes
-- a commission (marketplace_settings.commission_percent). The remainder is
-- payable to the institution.
--
-- Each row here represents a settlement event — the super admin clicked
-- "Mark Paid" on the Institution Payout table and transferred N rupees to
-- the institution. The institution's wallet balance is the cumulative SUM
-- of these rows.
--
-- We snapshot the commission % AT PAYOUT TIME so historical entries don't
-- change retroactively if the platform later raises/lowers the rate.
-- ============================================================================

CREATE TABLE IF NOT EXISTS institution_payouts (
  id                 SERIAL PRIMARY KEY,
  institution_id     INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  gross_amount       NUMERIC(12, 2) NOT NULL,    -- total course-purchase amount included in this payout
  commission_percent NUMERIC(5, 2)  NOT NULL,    -- snapshot of the commission % at payout time
  commission_amount  NUMERIC(12, 2) NOT NULL,    -- gross * pct / 100
  transfer_amount    NUMERIC(12, 2) NOT NULL,    -- gross - commission_amount (the amount actually paid out)
  status             VARCHAR(20)    NOT NULL DEFAULT 'paid'
                       CHECK (status IN ('paid', 'reversed')),
  paid_by            INTEGER REFERENCES users(id),
  paid_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  note               TEXT,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Hot path: the wallet view sums by institution_id, and the super-admin
-- ledger view sorts by paid_at DESC.
CREATE INDEX IF NOT EXISTS idx_institution_payouts_institution
  ON institution_payouts(institution_id);
CREATE INDEX IF NOT EXISTS idx_institution_payouts_paid_at
  ON institution_payouts(paid_at DESC);
