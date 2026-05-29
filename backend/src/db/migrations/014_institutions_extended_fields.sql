-- 014_institutions_extended_fields.sql
--
-- Category-based institution registration.
-- The mobile setup form now has 5 categories:
--   1. Core Details
--   2. Contact & Location
--   3. Accreditation
--   4. Operations
--   5. Point of Contact (Master)
--
-- This migration adds nullable columns for every field that doesn't already
-- exist on the institutions table. Existing columns we reuse as-is:
--   logo_url               -> Brand_Logo
--   address                -> Head_Office_Address
--   email                  -> Official_Email_Address (we keep the existing column)
--   phone                  -> Primary_Contact_Number
--   website_url            -> Website_URL
--   institution_type       -> Institution_Type
--   registration_number    -> Registration_Number
--   master_name            -> Master_Name
--
-- Everything else is added below. All new columns are NULLABLE so existing
-- institution rows continue to work without backfilling.

BEGIN;

-- ── Core Details ─────────────────────────────────────────────────────────
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS brand_name VARCHAR(150);
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS date_of_establishment DATE;

-- ── Contact & Location ───────────────────────────────────────────────────
-- no_of_branches is a simple integer; branches is a JSONB array of branch
-- address objects (e.g. [{ name: 'T. Nagar', address: '...', city: '...',
-- pincode: '...' }, ...]). We keep it JSONB instead of a separate table so
-- it can be edited atomically with the rest of the form; if branches grow
-- legs (per-branch trainers, schedules, etc.) we'll promote them later.
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS no_of_branches INTEGER DEFAULT 0;
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS branches JSONB DEFAULT '[]'::jsonb;

-- ── Accreditation ────────────────────────────────────────────────────────
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS affiliation_or_board VARCHAR(150);
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS accreditation_body_name VARCHAR(200);
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS accreditation_expiry_date DATE;
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS accreditation_certificate_url VARCHAR(500);

-- ── Operations ───────────────────────────────────────────────────────────
-- current_student_enrollment_count is intentionally NOT stored — it's
-- derived live from the enrollments table by the GET endpoints.
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS total_student_capacity INTEGER;
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS medium_of_instruction TEXT[];
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS operating_hours VARCHAR(150);

-- ── Point of Contact (Master) ────────────────────────────────────────────
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS master_role VARCHAR(100);
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS master_email VARCHAR(150);
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS master_phone_number VARCHAR(20);

COMMIT;
