-- 018_password_reset_otp.sql
--
-- Adds the columns needed for the forgot-password flow. We store a bcrypt
-- HASH of the OTP (not the OTP itself), so a DB dump can't be used to log
-- in as someone else even if we never get around to deleting the row.
--
-- Flow recap:
--   1. POST /auth/forgot-password { email }
--      -> generate 6-digit OTP, hash, store hash + 10-min expiry, email OTP
--   2. POST /auth/reset-password { email, otp, new_password }
--      -> verify hash + expiry + attempts<5, update users.password, clear OTP

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_hash     VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_expires  TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_attempts INTEGER DEFAULT 0;

COMMIT;
