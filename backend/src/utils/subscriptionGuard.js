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
            sp.billing_cycle AS plan_billing_cycle
       FROM institutions i
       LEFT JOIN subscription_plans sp ON sp.id = i.plan_id
      WHERE i.id = $1`,
    [institutionId],
  );
  if (rows.length === 0) return 'pending';
  const r = rows[0];
  const now = new Date();

  // ── Paid path ──────────────────────────────────────────────────────────
  // We pick the latest available "next renewal" timestamp from either
  // subscription_end (set by approveInstitution / mock-pay) or paid_at +
  // billing cycle. Whichever is later wins so renewals don't get
  // false-positive expired flags when one column was missed.
  //
  // Post-renewal we layer a 3-day grace window (migration 075) —
  // premium features are blocked immediately (spec: "disable all
  // premium features") but the account can still LOG IN so the user
  // sees the banner and can renew. `paid_grace` is treated identically
  // to `expired` by the guard for the feature block; the split just
  // gives observability + a distinct client-side banner state.
  if (r.paid_at) {
    const paidAt = new Date(r.paid_at);
    const cycle  = String(r.plan_billing_cycle || 'monthly').toLowerCase();
    const fromPaidAt = new Date(paidAt);
    if (cycle === 'yearly') {
      fromPaidAt.setFullYear(fromPaidAt.getFullYear() + 1);
    } else {
      fromPaidAt.setMonth(fromPaidAt.getMonth() + 1);
    }
    const fromSubEnd = r.subscription_end ? new Date(r.subscription_end) : null;
    const renewalDue = fromSubEnd && fromSubEnd > fromPaidAt ? fromSubEnd : fromPaidAt;
    if (now <= renewalDue) return 'paid';
    // Past renewal — check grace window.
    const graceEnd = new Date(renewalDue);
    graceEnd.setDate(graceEnd.getDate() + 3);
    return now <= graceEnd ? 'paid_grace' : 'expired';
  }

  // ── Trial / grace path ────────────────────────────────────────────────
  if (r.trial_ends_at) {
    if (now <= new Date(r.trial_ends_at)) return 'trial';
    if (r.grace_ends_at && now <= new Date(r.grace_ends_at)) return 'grace';
    return 'locked';
  }

  // ── Legacy approved institutions ───────────────────────────────────────
  // Pre-trial-system rows: onboarding_status='active' but no paid_at and no
  // trial_ends_at. Trial-status endpoint treats these as 'active' so they
  // can keep using the app, and we mirror that here so the guard doesn't
  // block them. If subscription_end is set and has passed, treat as
  // expired; otherwise grant access.
  if (r.onboarding_status === 'active') {
    if (r.subscription_end && now > new Date(r.subscription_end)) return 'expired';
    return 'paid';
  }

  return 'pending';
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
      // Both paid_grace and expired reject premium features. The
      // client-side banner reads phase from /onboarding/subscription-
      // status and shows the countdown for paid_grace (3 → 2 → 1)
      // or the hard "renew to regain access" copy for expired.
      const message =
        phase === 'paid_grace'
          ? 'Your subscription has expired. Renew within 3 days to continue using Veerify.'
        : phase === 'expired'
          ? 'Your subscription has expired. Please renew your plan to regain access.'
        : phase === 'locked'
          ? 'Your trial period has ended. Renew your plan to keep adding students, staff, courses and batches.'
        : 'Your institution is not yet approved.';
      return res.status(402).json({
        code: phase === 'paid_grace' ? 'PLAN_IN_GRACE' : 'PLAN_EXPIRED',
        phase,
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
