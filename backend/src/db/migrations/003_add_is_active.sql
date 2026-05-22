-- Migration 003: soft-disable flag for institutions.
--
-- Adds is_active to institutions. Independent of onboarding_status — a fully
-- onboarded academy (onboarding_status='active') can be temporarily turned
-- OFF (is_active=false) without losing its subscription/payment history.
--
-- Run via the migration runner:
--   npm run migrate -- src/db/migrations/003_add_is_active.sql

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
