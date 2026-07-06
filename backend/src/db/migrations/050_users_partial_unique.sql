-- 050_users_partial_unique.sql
--
-- Root fix for "a deleted user's email/phone blocks a new registration".
--
-- The users table has a plain UNIQUE constraint on email that was
-- created back in schema.sql. Plain unique constraints apply to
-- EVERY row, including soft-deleted ones (is_deleted = TRUE). So even
-- though the app-level validator (contactValidation.js#ensureEmailUnique)
-- already filters by is_deleted = FALSE, the INSERT itself still fails
-- with a "duplicate key value violates unique constraint" error when
-- a soft-deleted row still holds that email.
--
-- Fix: swap the plain UNIQUE for a PARTIAL UNIQUE INDEX that only
-- applies to rows where is_deleted = FALSE. Do the same for phone so
-- both fields behave identically. Emails are compared case-insensitively
-- (LOWER) — anyone signing in as You@Example.com finds the same row as
-- you@example.com, and re-registering a case-variant of a deleted
-- email doesn't sneak past.
--
-- Idempotency: the DROP looks up the actual constraint name at runtime
-- because pg auto-generates names like users_email_key from the schema
-- syntax; a rename or restore might have picked something else.

DO $$
DECLARE
  cname text;
BEGIN
  -- 1. Drop the plain UNIQUE on users.email if it still exists.
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'users'::regclass
     AND contype  = 'u'
     AND array_length(conkey, 1) = 1
     AND conkey[1] = (
       SELECT attnum FROM pg_attribute
        WHERE attrelid = 'users'::regclass AND attname = 'email'
     );
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', cname);
    RAISE NOTICE 'Dropped plain UNIQUE on users.email (%)', cname;
  END IF;

  -- 2. Same for phone, if there ever was one (there isn't in fresh
  --    schemas, but a hand-added constraint could exist on VPS clones).
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'users'::regclass
     AND contype  = 'u'
     AND array_length(conkey, 1) = 1
     AND conkey[1] = (
       SELECT attnum FROM pg_attribute
        WHERE attrelid = 'users'::regclass AND attname = 'phone'
     );
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', cname);
    RAISE NOTICE 'Dropped plain UNIQUE on users.phone (%)', cname;
  END IF;
END $$;

-- 3. Partial unique indexes — only enforce uniqueness while the row is
--    ALIVE. A soft-deleted row keeps its email/phone in place for audit
--    but a fresh user can immediately claim the same values.
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_alive
  ON users (LOWER(email))
  WHERE is_deleted = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_phone_alive
  ON users (phone)
  WHERE is_deleted = FALSE AND phone IS NOT NULL AND phone <> '';
