-- 017_student_profiles.sql
--
-- Personal details that students fill in when they enroll in their first
-- course. One row per student (keyed by user_id), upserted on every new
-- enrollment so the form can pre-populate next time.
--
-- We also add payment_reference + paid_at on enrollments so the mock-pay
-- flow can record when the payment went through. Razorpay will replace the
-- mock flow later but the columns stay the same.

BEGIN;

CREATE TABLE IF NOT EXISTS student_profiles (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Identity
  full_name           VARCHAR(150) NOT NULL,
  date_of_birth       DATE,
  gender              VARCHAR(20),

  -- Family
  father_name         VARCHAR(150),
  mother_name         VARCHAR(150),

  -- Contact (these mirror users.email/phone but are captured per enrollment
  -- because the enrollment form is the source of truth for the student's
  -- address & emergency contact)
  contact_number      VARCHAR(20),
  email               VARCHAR(150),
  address             TEXT,

  -- Personal status
  marital_status      VARCHAR(40),
  occupation          VARCHAR(120),

  -- Physical
  height_cm           INTEGER,
  weight_kg           INTEGER,
  disabilities        TEXT,

  -- Photo URL
  photo_url           TEXT,

  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_student_profiles_user
  ON student_profiles (user_id);

-- Payment columns on enrollments. payment_status already exists from the
-- bootstrap schema (values pending/paid/failed).
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(120);
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS payment_amount    NUMERIC(10, 2);
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS paid_at           TIMESTAMP;

COMMIT;
