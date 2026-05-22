// backend/scripts/reset-password.js
//
// Set a user's password directly. Useful when you've forgotten the password
// you used during a registration test.
//
// Usage:
//   node scripts/reset-password.js <email> <newPassword>

require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const [email, newPassword] = process.argv.slice(2);
if (!email || !newPassword) {
  console.error('Usage: node scripts/reset-password.js <email> <newPassword>');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const hash = await bcrypt.hash(newPassword, 10);
  const r = await pool.query(
    `UPDATE users SET password = $1 WHERE email = $2 RETURNING id, name, email, role`,
    [hash, email],
  );
  if (r.rows.length === 0) {
    console.error(`❌ No user with email ${email}`);
    process.exit(1);
  }
  console.log(`✅ Password reset for:`, r.rows[0]);
  console.log(`   New password: ${newPassword}`);
  await pool.end();
})();
