// backend/scripts/force-activate.js
//
// Recovery helper: forces an institution back to onboarding_status='active'
// IFF its payment_link_status is 'paid' (i.e., the academy already paid but
// the status field is inconsistent for any reason).
//
// Usage:
//   node scripts/force-activate.js <ownerEmail>
//   node scripts/force-activate.js --inst-id 14

require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
let target;
if (args[0] === '--inst-id' && args[1]) {
  target = { mode: 'id', value: Number(args[1]) };
} else if (args[0]) {
  target = { mode: 'email', value: args[0] };
} else {
  console.error('Usage:');
  console.error('  node scripts/force-activate.js <ownerEmail>');
  console.error('  node scripts/force-activate.js --inst-id <institutionId>');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  let inst;
  if (target.mode === 'id') {
    const r = await pool.query(
      `SELECT i.*, u.email AS owner_email FROM institutions i
       JOIN users u ON i.owner_user_id = u.id WHERE i.id = $1`,
      [target.value],
    );
    inst = r.rows[0];
  } else {
    const r = await pool.query(
      `SELECT i.*, u.email AS owner_email FROM institutions i
       JOIN users u ON i.owner_user_id = u.id WHERE u.email = $1`,
      [target.value],
    );
    inst = r.rows[0];
  }

  if (!inst) {
    console.error('❌ No matching institution found.');
    process.exit(1);
  }

  console.log(`\nFound institution #${inst.id} — ${inst.name} (owner: ${inst.owner_email})`);
  console.log(`  current onboarding_status = ${inst.onboarding_status}`);
  console.log(`  payment_link_status        = ${inst.payment_link_status}`);
  console.log(`  paid_at                    = ${inst.paid_at}`);

  if (inst.onboarding_status === 'active') {
    console.log('\n✅ Already active. Nothing to do.');
    process.exit(0);
  }

  if (inst.payment_link_status !== 'paid') {
    console.log('\n⚠ payment_link_status is not "paid" — refusing to force-activate.');
    console.log('   If you really want to activate without payment, use the admin web "Manually Activate" button.');
    process.exit(1);
  }

  const upd = await pool.query(
    `UPDATE institutions SET
       onboarding_status = 'active',
       status            = 'approved',
       subscription_start = COALESCE(subscription_start, paid_at, NOW()),
       subscription_end   = COALESCE(subscription_end, paid_at + INTERVAL '30 days', NOW() + INTERVAL '30 days')
     WHERE id = $1
     RETURNING id, name, onboarding_status, subscription_start, subscription_end`,
    [inst.id],
  );

  await pool.query(
    `UPDATE users SET status = 'active' WHERE id = $1`,
    [inst.owner_user_id],
  );

  console.log('\n✅ Repaired.');
  console.log(upd.rows[0]);

  await pool.end();
})();
