-- 078_institutions_status_inactive.sql
--
-- Post-expiry lifecycle bug fix.
--
-- Migration 075 introduced the subscription_expiry scheduler, which
-- moves institutions through
--   active → expired → inactive
-- on the subscription_status column, and (per its comments) also
-- flips institutions.status = 'inactive' when the post-payment grace
-- window closes so the login gate refuses those accounts.
--
-- But institutions.status still carries the schema.sql CHECK
--   CHECK (status IN ('pending', 'approved', 'rejected'))
-- which was written before the lifecycle scheduler existed. Every
-- inactive transition therefore throws
--   new row for relation "institutions" violates check constraint
--   "institutions_status_check"
-- and the scheduler loops on the same rows forever, filling logs and
-- never actually locking the accounts.
--
-- Fix: widen the CHECK to include 'active' and 'inactive'. Both values
-- are already emitted by production paths (schema.sql itself defaults
-- users.status to 'active', and the expiry scheduler writes
-- 'inactive'). Backfill nothing — every existing value is already in
-- the new set.

BEGIN;

DO $$
DECLARE
  cname text;
BEGIN
  -- Find the CHECK constraint on institutions.status regardless of
  -- what postgres named it (pg auto-generates institutions_status_check
  -- from the schema syntax; a rename or restore might have picked
  -- something else).
  SELECT conname INTO cname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum   = ANY (c.conkey)
   WHERE c.conrelid = 'institutions'::regclass
     AND c.contype  = 'c'
     AND a.attname  = 'status'
   LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE institutions DROP CONSTRAINT %I', cname);
    RAISE NOTICE 'Dropped old CHECK constraint on institutions.status (%)', cname;
  END IF;
END $$;

ALTER TABLE institutions
  ADD CONSTRAINT institutions_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'active', 'inactive'));

COMMIT;
