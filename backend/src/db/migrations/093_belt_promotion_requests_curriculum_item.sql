-- 093_belt_promotion_requests_curriculum_item.sql
--
-- BUG FIX: promotion status must be tracked PER curriculum item
-- (Level 1 / Level 2 / ...), not per student. Before this change the
-- mobile trainer screen was painting every curriculum row with the
-- single latest-request state, so promoting Level 1 also marked
-- Level 2, Level 3 etc. as "Pending Approval".
--
-- Adds a nullable curriculum_item_id column so historical requests
-- keep working (they simply aren't per-item scoped) and future
-- requests carry the exact item id. The old student-level partial
-- unique index is replaced with one that also keys on the item so
-- a student can have one pending request per item.
--
-- Idempotent — safe to re-run.

ALTER TABLE belt_promotion_requests
  ADD COLUMN IF NOT EXISTS curriculum_item_id INTEGER;

-- Best-effort FK. Wrapped in DO block so re-runs don't error and so
-- environments where the referenced table has a different name still
-- succeed (the column stays valid — the constraint is a nice-to-have).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'belt_promotion_requests_curriculum_item_fk'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'curriculum_items'
  ) THEN
    ALTER TABLE belt_promotion_requests
      ADD CONSTRAINT belt_promotion_requests_curriculum_item_fk
      FOREIGN KEY (curriculum_item_id)
      REFERENCES curriculum_items(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Drop the old student-level partial unique index so a student can
-- have simultaneous pending requests for different curriculum items.
-- The old index name comes from migration 085.
DROP INDEX IF EXISTS belt_promotion_requests_student_pending_uk;
-- Older migration environments may have used a different name.
DROP INDEX IF EXISTS belt_promotion_requests_pending_student_uk;

-- New guard: at most one pending request per (student, curriculum
-- item) pair. NULL curriculum_item_id rows (legacy student-level
-- requests) don't collide with anything — Postgres treats NULL as
-- distinct in unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS belt_promotion_requests_student_item_pending_uk
  ON belt_promotion_requests (student_id, curriculum_item_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS belt_promotion_requests_student_item_idx
  ON belt_promotion_requests (student_id, curriculum_item_id);
