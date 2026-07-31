// src/utils/subscriptionGuard.js
//
// Middleware that blocks "create" actions (enrolling students, creating
// trainers / courses / batches) when the institution's subscription is no
// longer valid.
//
// Valid phases — request continues:
//   trial   : free trial still active
//   grace   : payment overdue but still within grace days
//   paid    : paid AND within current billing cycle (monthly / yearly)
//
// Blocked phases — 402 PLAN_EXPIRED / PLAN_LOCKED:
//   pending : institution not yet approved
//   locked  : trial + grace exhausted, no payment
//   expired : was paid, but billing cycle elapsed without renewal
//
// We compute the phase fresh on every request so the gate flips the moment
// the cycle ends — no nightly cron required.

const pool = require('../config/db');

async function getCurrentPhase(institutionId) {
  if (!institutionId) return 'pending';
  const { rows } = await pool.query(
    `SELECT i.onboarding_status, i.subscription_end,
            i.trial_starts_at, i.trial_ends_at, i.grace_ends_at, i.paid_at,
            i.parent_institution_id,
            sp.billing_cycle AS plan_billing_cycle
       FROM institutions i
       LEFT JOIN subscription_plans sp ON sp.id = i.plan_id
      WHERE i.id = $1`,
    [institutionId],
  );
  if (rows.length === 0) return 'pending';
  const r = rows[0];
  const now = new Date();

  // ── Helper to evaluate a single row's phase ──────────────────────────
  const evalRow = (row) => {
    if (row.paid_at) {
      const paidAt = new Date(row.paid_at);
      const cycle  = String(row.plan_billing_cycle || 'monthly').toLowerCase();
      const fromPaidAt = new Date(paidAt);
      if (cycle === 'yearly') {
        fromPaidAt.setFullYear(fromPaidAt.getFullYear() + 1);
      } else {
        fromPaidAt.setMonth(fromPaidAt.getMonth() + 1);
      }
      const fromSubEnd = row.subscription_end ? new Date(row.subscription_end) : null;
      const renewalDue = fromSubEnd && fromSubEnd > fromPaidAt ? fromSubEnd : fromPaidAt;
      if (now <= renewalDue) return 'paid';
      const graceEnd = new Date(renewalDue);
      graceEnd.setDate(graceEnd.getDate() + 3);
      return now <= graceEnd ? 'paid_grace' : 'expired';
    }

    if (row.trial_ends_at) {
      if (now <= new Date(row.trial_ends_at)) return 'trial';
      if (row.grace_ends_at && now <= new Date(row.grace_ends_at)) return 'grace';
      return 'locked';
    }

    if (row.onboarding_status === 'active' || row.onboarding_status === 'approved') {
      if (row.subscription_end && now > new Date(row.subscription_end)) return 'expired';
      return 'paid';
    }

    return 'pending';
  };

  const selfPhase = evalRow(r);
  // Sub-branch inheritance: if sub-branch row alone yields non-active state,
  // evaluate the parent institution so active parent subscription covers child branches.
  if ((selfPhase === 'pending' || selfPhase === 'locked' || selfPhase === 'expired') && r.parent_institution_id) {
    const parentPhase = await getCurrentPhase(r.parent_institution_id);
    if (parentPhase === 'paid' || parentPhase === 'trial' || parentPhase === 'grace') {
      return parentPhase;
    }
  }

  return selfPhase;
}

// Express middleware. Looks up the admin's institution, derives the phase,
// and 402s if the phase blocks creation. Pass-through for trial / grace /
// paid. Super-admin bypasses the gate entirely.
async function requireActiveSubscription(req, res, next) {
  try {
    if (req.user?.role === 'super_admin') return next();

    // Resolve institution id. For admin/trainer the JWT carries it directly;
    // for student self-enrolment the institution comes from the batch row,
    // not the user, so we skip the gate for students (they can't make the
    // institution money if it's expired anyway — the relevant flows here are
    // admin-driven).
    let institutionId = null;
    if (req.user?.institution_id) {
      institutionId = req.user.institution_id;
    } else if (req.user?.userId) {
      const { rows } = await pool.query(
        'SELECT institution_id FROM users WHERE id = $1',
        [req.user.userId],
      );
      institutionId = rows[0]?.institution_id || null;
    }
    if (!institutionId) return next(); // Nothing to gate.

    const phase = await getCurrentPhase(institutionId);

    if (phase === 'expired' || phase === 'paid_grace' || phase === 'locked' || phase === 'pending') {
      // Is the caller a branch? A branch inherits its parent's
      // subscription and CAN'T renew on its own — the mobile modal
      // must show a passive "your institution's subscription has
      // expired" message with only OK/Later, no Renew CTA.
      let isBranch = false;
      try {
        const r = await pool.query(
          `SELECT parent_institution_id FROM institutions WHERE id = $1`,
          [institutionId],
        );
        isBranch = !!(r.rows[0]?.parent_institution_id);
      } catch (_) { /* fall back to non-branch copy */ }

      const branchMessage =
        "Your institution's subscription has expired. Access will be restored once the renewal is completed.";
      const message = isBranch
        ? branchMessage
        : phase === 'paid_grace'
          ? 'Your subscription has expired. Renew within 3 days to continue using Veerify.'
        : phase === 'expired'
          ? 'Your subscription has expired. Please renew your plan to regain access.'
        : phase === 'locked'
          ? 'Your trial period has ended. Renew your plan to keep adding students, staff, courses and batches.'
        : 'Your institution is not yet approved.';
      return res.status(402).json({
        code: phase === 'paid_grace' ? 'PLAN_IN_GRACE' : 'PLAN_EXPIRED',
        phase,
        is_branch: isBranch,
        message,
      });
    }

    next();
  } catch (err) {
    console.error('[subscriptionGuard]', err);
    // Fail-open: don't block business if our gate itself errors.
    next();
  }
}

module.exports = { requireActiveSubscription, getCurrentPhase };
