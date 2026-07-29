-- 073_plan_whatsapp_notifications.sql
--
-- Adds the "WhatsApp Notifications" toggle to subscription plans.
--
--   whatsapp_notifications_enabled — master switch per plan. When
--     TRUE, institutions subscribed to this plan may dispatch
--     WhatsApp messages through the integrated provider. When FALSE
--     (default), the backend guard refuses WhatsApp sends and the
--     app falls back to email / in-app channels.
--
-- Enforcement lives in the application layer — see the
-- `assertWhatsAppAllowed` helper on utils/planFeatureGuard.js which
-- reads users.institution_id → subscription_plans.
--
-- Default is FALSE so every existing plan starts opted-out per spec
-- ("Default: OFF"). Super-admins flip it on per plan from the Web
-- Admin Plans editor.

BEGIN;

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS whatsapp_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
