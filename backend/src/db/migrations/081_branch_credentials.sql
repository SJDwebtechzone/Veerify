-- 081_branch_credentials.sql
--
-- Branch activation workflow.
--
--   • credentials_sent_at — timestamp of the first successful
--     "Send Credentials" dispatch by the Super Admin. NULL means
--     the branch is still Pending Activation and cannot log in.
--     Institution registration-time branches (setupAcademy flow)
--     get this stamped at creation because they're auto-provisioned;
--     branches added later via POST /branches leave it NULL.
--
--   • credentials_sent_by — which super-admin user pressed the
--     button, for the audit trail.
--
-- Idempotent — a second Send Credentials is a no-op for status but
-- can be used to resend the message; controller decides.

BEGIN;

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS credentials_sent    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS credentials_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS credentials_sent_by INTEGER;

-- Backfill: every existing institution (main institutions + pre-migration
-- sub-branches from the old auto-provision flow) is treated as
-- credentials-already-sent so they're not accidentally flagged Pending
-- Activation. Only rows created AFTER this migration start FALSE.
UPDATE institutions
   SET credentials_sent = TRUE,
       credentials_sent_at = COALESCE(credentials_sent_at, created_at, NOW())
 WHERE credentials_sent_at IS NULL
   AND deleted_at IS NULL;

COMMIT;
