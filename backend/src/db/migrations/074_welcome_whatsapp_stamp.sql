-- 074_welcome_whatsapp_stamp.sql
--
-- Adds a one-time stamp column for the "Welcome WhatsApp" message
-- fired after successful account creation.
--
--   welcome_wa_sent_at — TIMESTAMPTZ, NULL until the welcome
--     WhatsApp lands successfully. The register / account-creation
--     helpers filter on IS NULL before dispatching so an account
--     can never receive the welcome message twice, even if the
--     helper is invoked repeatedly (retries, re-runs, bad clients).
--
-- The gate itself (plan.whatsapp_notifications_enabled from
-- migration 073) is evaluated in application code via
-- planFeatureGuard.isWhatsAppEnabledForUser. This stamp is only for
-- the "send only once" contract.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS welcome_wa_sent_at TIMESTAMPTZ;

COMMIT;
