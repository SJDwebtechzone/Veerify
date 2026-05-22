-- ============================================================================
-- 005_soft_delete_institutions.sql
-- ----------------------------------------------------------------------------
-- Switches institution "delete" to a soft delete so an owner can come back
-- with the same login credentials and either restore their old academy or
-- start fresh.
--
-- New columns on `institutions`:
--   deleted_at        TIMESTAMPTZ  -- when the row was soft-deleted
--   deleted_by        INTEGER      -- user.id of whoever pulled the trigger
--   deletion_source   VARCHAR(20)  -- 'admin' (super-admin deleted) or
--                                  -- 'owner' (academy owner self-deleted)
--   deletion_reason   TEXT
--   prev_onboarding_status VARCHAR(30) -- snapshot of onboarding_status taken
--                                       -- at delete time so restore can put
--                                       -- the row back to where it was.
--
-- We also add a partial index so the "active (non-deleted) institutions"
-- predicate stays cheap.
-- ============================================================================

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS deleted_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_source        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS deletion_reason        TEXT,
  ADD COLUMN IF NOT EXISTS prev_onboarding_status VARCHAR(30);

-- Constrain deletion_source to the two known values (or NULL when alive).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'institutions_deletion_source_chk'
  ) THEN
    ALTER TABLE institutions
      ADD CONSTRAINT institutions_deletion_source_chk
      CHECK (deletion_source IS NULL OR deletion_source IN ('admin', 'owner'));
  END IF;
END $$;

-- Fast "alive only" lookups — most queries filter `deleted_at IS NULL`.
CREATE INDEX IF NOT EXISTS idx_institutions_alive
  ON institutions (id)
  WHERE deleted_at IS NULL;

-- And a small index for the trash view / restore screen.
CREATE INDEX IF NOT EXISTS idx_institutions_deleted_at
  ON institutions (deleted_at DESC)
  WHERE deleted_at IS NOT NULL;
