-- ============================================================================
-- 026_refer_and_earn.sql
-- ----------------------------------------------------------------------------
-- Institution-to-institution referral programme.
--
-- Concepts:
--   referral_settings        - single configuration row (id=1). Defaults:
--                              500 pts/referral, 1 pt = ₹1, max 50% off,
--                              points expire after 180 days, auto-approve.
--   referral_code on inst    - VEER-XXXXXX style, unique, generated on demand.
--   referred_by_institution  - foreign-key set when an institution registers
--                              with someone else's code.
--   referrals                - one row per (referrer, referred) pair, tracks
--                              status: pending → completed → credited (or
--                              expired). Reward is only emitted ONCE per
--                              referred institution (UNIQUE constraint).
--   referral_wallets         - cumulative balance per institution.
--   referral_transactions    - ledger of earn / use / expire events,
--                              double-entry-friendly (positive points for
--                              earn, negative for use/expire).
-- ============================================================================

BEGIN;

-- ── Single-row settings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_settings (
  id                   INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  points_per_referral  INTEGER       NOT NULL DEFAULT 500,
  rupees_per_point     NUMERIC(6, 2) NOT NULL DEFAULT 1.00,
  max_discount_pct     INTEGER       NOT NULL DEFAULT 50
                         CHECK (max_discount_pct BETWEEN 0 AND 100),
  points_expiry_days   INTEGER       NOT NULL DEFAULT 180,
  auto_approve         BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO referral_settings (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- ── Institution columns ─────────────────────────────────────────────────────
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS referral_code              VARCHAR(20) UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by_institution_id INTEGER
    REFERENCES institutions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_institutions_referred_by
  ON institutions(referred_by_institution_id);

-- ── Referrals (one row per referred institution) ────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id                       SERIAL PRIMARY KEY,
  referrer_institution_id  INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  referred_institution_id  INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  referral_code            VARCHAR(20) NOT NULL,
  status                   VARCHAR(20) NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'completed', 'credited', 'expired')),
  reward_points            INTEGER DEFAULT 0,
  rewarded_at              TIMESTAMP,
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- A given institution can only be referred once; the UNIQUE here is what
  -- blocks duplicate / self-referral abuse at the DB layer.
  UNIQUE (referred_institution_id),
  CHECK (referrer_institution_id <> referred_institution_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer
  ON referrals(referrer_institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_status
  ON referrals(status);

-- ── Wallet (running totals; one row per institution) ────────────────────────
CREATE TABLE IF NOT EXISTS referral_wallets (
  institution_id  INTEGER PRIMARY KEY REFERENCES institutions(id) ON DELETE CASCADE,
  points_balance  INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  total_earned    INTEGER NOT NULL DEFAULT 0,
  total_used      INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Ledger ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_transactions (
  id              SERIAL PRIMARY KEY,
  institution_id  INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  type            VARCHAR(20) NOT NULL CHECK (type IN ('earned', 'used', 'expired')),
  points          INTEGER NOT NULL,   -- positive for earned, negative for used/expired
  description     TEXT,
  reference_id    INTEGER,            -- referral.id when type='earned', etc.
  status          VARCHAR(20) DEFAULT 'completed',
  expires_at      TIMESTAMPTZ,        -- when this earn-event's points expire
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referral_tx_institution
  ON referral_transactions(institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_tx_expiry
  ON referral_transactions(expires_at)
  WHERE type = 'earned' AND status = 'completed';

COMMIT;
