// backend/src/utils/billingCycle.js
//
// Single source of truth for how a course's `billing_cycle` value
// renders into human-facing copy. Used by:
//
//   • enrollment.controller.js — the Razorpay Payment Link description
//     shown to the payer on the hosted checkout page.
//   • invoice generation — the "Fee type" row on the PDF invoice.
//   • the mobile payment summary — reads billing_cycle straight off
//     the course row returned by /enrollments/:id/... endpoints.
//
// Keeping the mapping here means the label used by all three surfaces
// can never drift out of sync — one place to add a new cadence, one
// place to fix a typo.

const CYCLE_LABELS = {
  one_time:    'One-Time Fee',
  monthly:     'Monthly Fee',
  quarterly:   'Quarterly Fee',
  half_yearly: 'Half-Yearly Fee',
  annual:      'Annual Fee',
};

const CYCLE_CADENCE = {
  one_time:    'one-time',
  monthly:     'per month',
  quarterly:   'per quarter',
  half_yearly: 'per 6 months',
  annual:      'per year',
};

/**
 * Human label for the `billing_cycle` column on a course row.
 * Unknown / missing values fall back to "Monthly Fee" so an old row
 * that predates the migration renders sensibly.
 */
function billingCycleLabel(cycle) {
  const k = String(cycle || 'monthly').toLowerCase();
  return CYCLE_LABELS[k] || CYCLE_LABELS.monthly;
}

/**
 * Human cadence suffix used after a formatted amount, e.g.
 * "₹1,500 per month". Same fallback rules as billingCycleLabel.
 */
function billingCycleCadence(cycle) {
  const k = String(cycle || 'monthly').toLowerCase();
  return CYCLE_CADENCE[k] || CYCLE_CADENCE.monthly;
}

module.exports = {
  billingCycleLabel,
  billingCycleCadence,
  CYCLE_LABELS,
  CYCLE_CADENCE,
};
