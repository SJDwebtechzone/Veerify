-- Migration 028 — wizard v2 fields
--
-- Adds columns the redesigned 5-step institution setup wizard introduced:
--   • skills                       text[]   — martial-arts disciplines offered
--   • current_enrollment           integer  — students currently on the rolls
--   • latitude / longitude         double precision — head-office GPS for the
--                                    student-side "nearby academies" search
--   • operating_hours_weekday      jsonb    — structured Mon–Fri time slots
--                                    e.g. [{"start":"09:00","end":"12:00"}, …]
--   • operating_hours_weekend      jsonb    — structured Sat–Sun time slots
--
-- All columns are nullable so existing rows (pre-wizard-v2) keep working.

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS skills                    text[]            DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS current_enrollment        integer           DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS latitude                  double precision  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS longitude                 double precision  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS operating_hours_weekday   jsonb             DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS operating_hours_weekend   jsonb             DEFAULT NULL;

-- Helpful for the nearby search — narrow the table scan to rows that
-- actually have coordinates before applying the Haversine math.
CREATE INDEX IF NOT EXISTS idx_institutions_coords
  ON institutions (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
