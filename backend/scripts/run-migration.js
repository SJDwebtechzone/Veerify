// backend/scripts/run-migration.js
//
// Tiny SQL file runner. Reuses DATABASE_URL from backend/.env (same connection
// the API uses) so you don't need psql on PATH or any shell-variable tricks.
//
// Usage:
//   node scripts/run-migration.js src/db/migrations/002_add_payment_columns.sql
//
// Or via the npm script defined in package.json:
//   npm run migrate -- src/db/migrations/002_add_payment_columns.sql

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Pool } = require('pg');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/run-migration.js <path-to-sql-file>');
  process.exit(1);
}

const sqlPath = path.resolve(file);
if (!fs.existsSync(sqlPath)) {
  console.error(`SQL file not found: ${sqlPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to backend/.env first.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  console.log(`▶ Running ${path.basename(sqlPath)} against ${process.env.DATABASE_URL.replace(/\/\/[^@]+@/, '//***@')}`);
  try {
    await pool.query(sql);
    console.log('✅ Migration completed successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
