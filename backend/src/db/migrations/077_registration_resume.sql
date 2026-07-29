-- 077_registration_resume.sql
--
-- Resume Registration / Enrollment support.
--
-- Spec: an in-progress registration or enrollment must NOT permanently
-- reserve the email address / mobile number. If the same email or phone
-- is re-submitted before completion, the client should be able to
-- resume the previous attempt instead of getting an "already exists"
-- error. Once the registration truly completes (institution paid +
-- activated, student paid + enrolled, trainer account fully created),
-- the email/phone becomes reserved.
--
-- Implementation strategy:
--
--   • Add `users.registration_completed_at TIMESTAMPTZ` — NULL means
--     "still in an incomplete/draft/pending flow"; NOT NULL means the
--     account is fully live and the email/phone must not be reused.
--
--   • Replace the two "alive" partial unique indexes (migration 050)
--     with variants that only fire on ROWS whose registration is
--     completed. Incomplete rows contribute nothing to uniqueness,
--     which is exactly what "resume rather than block" requires.
--
--   • Backfill: any existing row is assumed complete (safest default)
--     so live accounts don't suddenly become collidable. A stray
--     abandoned row from before this migration will look complete and
--     therefore still block — that's acceptable; the fix ships forward
--     from here.
--
-- Case-insensitive email match preserved from migration 050.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS registration_completed_at TIMESTAMPTZ;

-- Backfill: existing rows are treated as completed so we don't
-- accidentally allow collisions with historical live accounts. New
-- registrations from the moment this migration lands are the ones
-- that get the incomplete → resume semantics.
UPDATE users
   SET registration_completed_at = COALESCE(created_at, NOW())
 WHERE registration_completed_at IS NULL
   AND COALESCE(is_deleted, FALSE) = FALSE;

-- Drop the old "alive" indexes and rebuild them so they only enforce
-- uniqueness on rows whose registration_completed_at IS NOT NULL.
DROP INDEX IF EXISTS ux_users_email_alive;
DROP INDEX IF EXISTS ux_users_phone_alive;

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_completed
  ON users (LOWER(email))
  WHERE is_deleted = FALSE
    AND registration_completed_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_phone_completed
  ON users (phone)
  WHERE is_deleted = FALSE
    AND phone IS NOT NULL AND phone <> ''
    AND registration_completed_at IS NOT NULL;

-- A helpful non-unique index so the resume lookup ("is there an
-- incomplete row for this email?") stays fast even under load. The
-- controller queries `LOWER(email) = LOWER($1) AND registration_completed_at IS NULL`.
CREATE INDEX IF NOT EXISTS ix_users_email_incomplete
  ON users (LOWER(email))
  WHERE is_deleted = FALSE
    AND registration_completed_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_users_phone_incomplete
  ON users (phone)
  WHERE is_deleted = FALSE
    AND phone IS NOT NULL AND phone <> ''
    AND registration_completed_at IS NULL;

COMMIT;
