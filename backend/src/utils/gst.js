// backend/src/utils/gst.js
//
// GST math helpers shared across the subscription module.
//
// Contract (spec — GST implementation):
//   base_price     = price the plan card advertises, GST-exclusive
//   gst_percent    = tax slab in effect for that plan / term (default 18)
//   gst_amount     = base_price × gst_percent / 100, rounded 2dp
//   total_payable  = base_price + gst_amount, rounded 2dp
//
// Rounding uses half-away-from-zero (`Math.round(v * 100) / 100`) which
// matches the client-side formatting used on the Web Admin and mobile
// pricing screens so a user never sees a paise-off mismatch between
// what the plan card says and what Razorpay actually charges.
//
// GST_PERCENT_DEFAULT (18) is the fallback anywhere a legacy row
// somehow lacks gst_percent — mirrors the migration DEFAULT.

const GST_PERCENT_DEFAULT = 18;

function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * Given a GST-exclusive base price and a GST rate, return the full
 * breakdown the API contract requires.
 *
 * `basePrice` and `gstPercent` accept any numeric-coercible input
 * (Postgres NUMERIC columns arrive as strings via node-postgres).
 */
function computeGst(basePrice, gstPercent) {
  const base = round2(basePrice);
  const pctRaw = Number(gstPercent);
  const pct = Number.isFinite(pctRaw) ? Math.max(0, Math.min(50, pctRaw)) : GST_PERCENT_DEFAULT;
  const gst = round2(base * (pct / 100));
  return {
    base_price:    base,
    gst_percent:   pct,
    gst_amount:    gst,
    total_payable: round2(base + gst),
  };
}

/**
 * Convenience: return just the amount to charge (total_payable) as a
 * 2dp number. Used at Razorpay-link mint sites where the caller
 * doesn't need the full breakdown, just the number of rupees to hand
 * to `createPaymentLink`.
 */
function totalPayable(basePrice, gstPercent) {
  return computeGst(basePrice, gstPercent).total_payable;
}

module.exports = {
  GST_PERCENT_DEFAULT,
  round2,
  computeGst,
  totalPayable,
};
