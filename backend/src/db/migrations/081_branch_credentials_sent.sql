ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS credentials_sent BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: wizard-created branches (created during setup) are already provisioned.
-- Mark them as sent so the "Send Credentials" button doesn't re-appear for old data.
-- A branch is wizard-provisioned if it has an owner_user_id that predates the branch
-- row (i.e. the user was created as part of setup, not post-hoc).
UPDATE institutions
   SET credentials_sent = TRUE
 WHERE parent_institution_id IS NOT NULL
   AND owner_user_id IS NOT NULL;
