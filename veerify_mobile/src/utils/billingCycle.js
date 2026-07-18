// src/utils/billingCycle.js
//
// Client-side twin of backend/src/utils/billingCycle.js. Keeps the
// "Monthly Fee" / "Quarterly Fee" / etc. copy identical wherever the
// mobile app renders a fee label. If the row's billing_cycle is
// missing (older courses that predate the migration) we render
// "Monthly Fee" — same fallback as the server.

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

export function billingCycleLabel(cycle) {
  const k = String(cycle || 'monthly').toLowerCase();
  return CYCLE_LABELS[k] || CYCLE_LABELS.monthly;
}

export function billingCycleCadence(cycle) {
  const k = String(cycle || 'monthly').toLowerCase();
  return CYCLE_CADENCE[k] || CYCLE_CADENCE.monthly;
}

// Ordered list for admin pickers so the dropdown stays consistent.
export const BILLING_CYCLE_OPTIONS = [
  { value: 'monthly',     label: 'Monthly Fee' },
  { value: 'quarterly',   label: 'Quarterly Fee' },
  { value: 'half_yearly', label: 'Half-Yearly Fee' },
  { value: 'annual',      label: 'Annual Fee' },
  { value: 'one_time',    label: 'One-Time Fee' },
];

export default {
  billingCycleLabel,
  billingCycleCadence,
  BILLING_CYCLE_OPTIONS,
};
