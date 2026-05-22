// backend/scripts/diagnose-user.js
//
// Quick diagnostic for the "logged in but routed to PlanSelection" issue.
// Usage:
//   node scripts/diagnose-user.js <email>
//
// Prints: the user row, whether they own an institution, the institution's
// onboarding_status, owner_user_id, and basic payment fields. Tells you
// exactly which of the three failure modes is happening.

require('dotenv').config();
const { Pool } = require('pg');

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/diagnose-user.js <email>');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  console.log(`\nDiagnosing user: ${email}\n${'─'.repeat(60)}`);

  const u = await pool.query(
    `SELECT id, name, email, role, status, institution_id, created_at
     FROM users WHERE email = $1`,
    [email],
  );

  if (u.rows.length === 0) {
    console.log('❌ No user found with that email.');
    console.log('   → You probably typed a different email when logging in.');
    process.exit(0);
  }

  const user = u.rows[0];
  console.log(`User row:`);
  console.log(`  id              = ${user.id}`);
  console.log(`  name            = ${user.name}`);
  console.log(`  role            = ${user.role}        ${user.role === 'admin' ? '' : '⚠ not admin'}`);
  console.log(`  status          = ${user.status}`);
  console.log(`  institution_id  = ${user.institution_id || '(null)'}`);

  if (user.role !== 'admin') {
    console.log('\n⚠ This user is not an admin — mobile login will not enter the admin flow.');
  }

  const i = await pool.query(
    `SELECT id, name, owner_user_id, onboarding_status, status,
            payment_link_status, paid_at, subscription_end, plan_id
     FROM institutions WHERE owner_user_id = $1`,
    [user.id],
  );

  console.log(`\nInstitutions owned: ${i.rows.length}`);
  if (i.rows.length === 0) {
    console.log('❌ No institution has this user as owner.');
    console.log('   → /onboarding/my-status will return "registered" → mobile routes to PlanSelection.');
    console.log('   FIX: either log in as the actual academy owner, or restart onboarding for this user.');
    process.exit(0);
  }

  for (const inst of i.rows) {
    console.log(`\n  Institution #${inst.id}`);
    console.log(`    name                 = ${inst.name}`);
    console.log(`    owner_user_id        = ${inst.owner_user_id}`);
    console.log(`    onboarding_status    = ${inst.onboarding_status}  ${inst.onboarding_status === 'active' ? '✅' : '⚠ not active'}`);
    console.log(`    status               = ${inst.status}`);
    console.log(`    payment_link_status  = ${inst.payment_link_status || '(null)'}`);
    console.log(`    paid_at              = ${inst.paid_at || '(null)'}`);
    console.log(`    subscription_end     = ${inst.subscription_end || '(null)'}`);
    console.log(`    plan_id              = ${inst.plan_id || '(null)'}`);
  }

  const live = i.rows.find(r => r.onboarding_status === 'active');
  if (live) {
    console.log('\n✅ User owns an ACTIVE institution. Mobile login should route to AdminDashboard.');
    console.log('   If it still goes to PlanSelection, the issue is in the mobile app, not the DB.');
  } else {
    console.log('\n⚠ User has institution(s), but none are active.');
    console.log('   → Mobile login will route based on the onboarding_status above:');
    console.log('     plan_selected    → SetupInstitution');
    console.log('     pending_approval → PendingApproval');
    console.log('     approved         → PaymentScreen');
    console.log('     active           → AdminDashboard');
    console.log('   FIX: go to admin web → Institutions → this academy → "Manually Activate".');
    console.log('   If that button is disabled, the row must first be in "approved" state (super admin needs to Approve).');
  }

  await pool.end();
})();
