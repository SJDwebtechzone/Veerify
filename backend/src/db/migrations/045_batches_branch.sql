-- 045_batches_branch.sql
--
-- Adds a per-batch branch assignment so the Create Batch flow can pin
-- each batch to either the Main Institution or one of the academy's
-- sub-branches. Nullable + safe defaults so every existing row keeps
-- working:
--
--   • branch_id IS NULL              → batch is at the main institution
--                                      (the default the mobile picks).
--   • branch_id = <sub_branch.id>    → batch is at that specific branch.
--
-- Foreign key targets institutions(id) with ON DELETE SET NULL so a
-- branch removal never orphans a row — the batch reverts to Main.
--
-- Existing rows: every row's branch_id defaults to NULL, which reads as
-- "at the main institution" everywhere. That matches the pre-migration
-- behaviour where batches were implicitly at the caller's own academy.

ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS branch_id INTEGER
    REFERENCES institutions(id) ON DELETE SET NULL;

-- Hot read paths filter by (institution_id, branch_id) when listing
-- batches for a specific branch, and by (institution_id) alone for the
-- whole academy — cover both.
CREATE INDEX IF NOT EXISTS idx_batches_institution_branch
  ON batches (institution_id, branch_id);
