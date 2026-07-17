-- 063_invoices.sql
--
-- Persisted invoice records for every successful payment on the
-- platform. Two kinds share this table:
--
--   • kind = 'enrollment'   → student paid a course fee via Razorpay
--                              or offline (payment_mode = cash/upi/…).
--   • kind = 'subscription' → institution paid their Veerify plan.
--
-- Each row corresponds to a generated PDF stored at pdf_path. The
-- number field is a human-shareable identifier (VRF-INV-<year>-<seq>)
-- that we print on the PDF and expose via the download endpoints.

BEGIN;

CREATE TABLE IF NOT EXISTS invoices (
  id                  SERIAL PRIMARY KEY,
  number              VARCHAR(40) UNIQUE NOT NULL,
  kind                VARCHAR(20) NOT NULL
                       CHECK (kind IN ('enrollment', 'subscription')),
  -- Foreign keys — nullable per-kind so we don't need two tables.
  enrollment_id       INTEGER REFERENCES enrollments(id)   ON DELETE SET NULL,
  institution_id      INTEGER REFERENCES institutions(id)  ON DELETE SET NULL,
  -- Denormalised payer + item snapshot so the invoice stays readable
  -- even after the underlying enrolment / institution is renamed or
  -- deleted. Rendered directly on the PDF.
  payer_name          VARCHAR(200),
  payer_email         VARCHAR(200),
  item_description    VARCHAR(500),
  -- Money — all values in ₹ paise-precision. tax_amount + subtotal =
  -- total_amount so we can display the breakdown on the invoice.
  subtotal_amount     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax_amount          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount        NUMERIC(12, 2) NOT NULL,
  currency            VARCHAR(3)  NOT NULL DEFAULT 'INR',
  -- Payment provenance so the invoice PDF can show it.
  payment_method      VARCHAR(40),   -- 'razorpay' | 'cash' | 'upi' | 'bank' | 'cheque'
  payment_reference   VARCHAR(120),  -- Razorpay payment id / plink id / offline ref
  -- Rendered PDF — served via GET /api/invoices/:id/pdf.
  pdf_path            TEXT NOT NULL,
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  emailed_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uniqueness guards — one invoice per payment. Partial indexes so a
-- row with the other kind can coexist without collision.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_enrollment
  ON invoices (enrollment_id) WHERE enrollment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_subscription_txn
  ON invoices (payment_reference) WHERE kind = 'subscription' AND payment_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_institution
  ON invoices (institution_id, issued_at DESC);

COMMIT;
