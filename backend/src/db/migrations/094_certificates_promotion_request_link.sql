-- 094_certificates_promotion_request_link.sql
--
-- FEATURE: back the belt-promotion certificate flow with a first-
-- class link between certificates and the belt_promotion_requests
-- row that produced them. Previously we stored the reverse link
-- (belt_promotion_requests.certificate_id → certificates.id) but
-- nothing prevented a second approve call from minting a duplicate
-- certificate for the same request. This migration:
--
--   1. Adds certificates.promotion_request_id (nullable, FK).
--   2. Backfills the new column from belt_promotion_requests so
--      certificates minted by the old approve handler are still
--      linked forward.
--   3. Adds a partial UNIQUE index so at most ONE certificate exists
--      per approved promotion request. Any accidental second insert
--      raises 23505, which the controller's idempotency guard turns
--      into a re-return of the already-issued certificate.
--
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS promotion_request_id INTEGER;

-- Best-effort FK. Wrapped in DO block so re-runs are quiet and
-- environments where belt_promotion_requests doesn't yet exist
-- (fresh DB rebuilds where migration order is unusual) still land.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'certificates_promotion_request_fk'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'belt_promotion_requests'
  ) THEN
    ALTER TABLE certificates
      ADD CONSTRAINT certificates_promotion_request_fk
      FOREIGN KEY (promotion_request_id)
      REFERENCES belt_promotion_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill from the reverse link so historical rows are populated
-- before the unique index goes on.
UPDATE certificates c
   SET promotion_request_id = r.id
  FROM belt_promotion_requests r
 WHERE r.certificate_id = c.id
   AND c.promotion_request_id IS NULL;

-- One certificate max per promotion request. NULL rows (non-belt
-- certificates: tournament / completion / achievement, plus legacy
-- rows that never got backfilled) don't collide — Postgres treats
-- NULL as distinct in unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_certificates_promotion_request
  ON certificates (promotion_request_id)
  WHERE promotion_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_certificates_promotion_request
  ON certificates (promotion_request_id);

COMMIT;
