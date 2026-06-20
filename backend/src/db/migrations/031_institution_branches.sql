-- ============================================================================
-- 031_institution_branches.sql
-- ----------------------------------------------------------------------------
-- Adds the institution_branches table — physical locations of a single
-- institution. The institution row continues to hold the registered /
-- head-office address; branches are *additional* training locations.
--
-- Why a separate table (not multiple lat/lng on institutions):
--   • An academy can grow to 5–50 branches; we need per-row attributes
--     (address, phone, hours, capacity, status).
--   • The student-side "nearby academies" search now blends institution
--     head offices + branch rows in one distance-sorted list.
--   • Per-branch revenue / attendance reporting becomes possible later
--     without another schema break.
--
-- The composite (latitude, longitude) index mirrors what we have on
-- institutions so the haversine query in branchController.getNearby
-- scans efficiently.
-- ============================================================================

CREATE TABLE IF NOT EXISTS institution_branches (
  id              SERIAL PRIMARY KEY,
  institution_id  INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name            VARCHAR(120) NOT NULL,
  address_line    TEXT,
  city            VARCHAR(80),
  state           VARCHAR(80),
  pin_code        VARCHAR(20),
  country         VARCHAR(80) DEFAULT 'India',
  phone           VARCHAR(30),
  email           VARCHAR(160),
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  -- Marks the institution's primary / flagship branch. Defaults to false
  -- so multiple flagged primaries can't get created accidentally; the
  -- admin can promote one via the edit form.
  is_primary      BOOLEAN DEFAULT FALSE,
  status          VARCHAR(20) DEFAULT 'active', -- 'active' | 'inactive'
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_branches_institution
  ON institution_branches (institution_id);

CREATE INDEX IF NOT EXISTS idx_branches_latlng
  ON institution_branches (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
