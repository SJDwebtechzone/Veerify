// backend/src/utils/razorpay.js
//
// Razorpay helper. Creates Payment Links and verifies webhook signatures.
//
// Required env vars (see backend/SETUP_PAYMENTS.md):
//   RAZORPAY_KEY_ID          From Razorpay dashboard (test keys start "rzp_test_")
//   RAZORPAY_KEY_SECRET      Secret paired with KEY_ID
//   RAZORPAY_WEBHOOK_SECRET  Set this when you configure the webhook in Razorpay
//   APP_BASE_URL             Optional — used as the customer's "return after pay"
//                            landing page. Defaults to the admin dashboard.

const crypto = require('crypto');
const Razorpay = require('razorpay');

const KEY_ID         = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET     = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// URL Razorpay redirects the payer back to after checkout. This must
// point at the FRONTEND — never the backend API — so the payer lands
// on a friendly success page instead of a raw JSON / API response.
// Resolution order: WEB_APP_URL (preferred) → APP_BASE_URL (legacy) →
// hard default of the production frontend, so a missing env in staging
// can't leak a localhost link into a Razorpay-hosted checkout page.
const WEB_APP_URL =
  process.env.WEB_APP_URL ||
  process.env.APP_BASE_URL ||
  'https://veerifyapp.com';

let client = null;

function getClient() {
  if (client) return client;
  if (!KEY_ID || !KEY_SECRET) {
    console.warn('[razorpay] RAZORPAY_KEY_ID/KEY_SECRET not set. Payment links will fail.');
    return null;
  }
  client = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
  return client;
}

/**
 * Create a Razorpay Payment Link for an institution's first subscription payment.
 *
 *   amountInRupees   Plan price in ₹ (e.g. 2999). Stored on subscription_plans.price.
 *   institution      The institution row joined with owner email + plan info.
 *
 * Returns { ok: true, link: { id, short_url, amountPaise } }
 *      or { ok: false, error }.
 *
 * Reference for the API:
 *   https://razorpay.com/docs/api/payments/payment-links/
 */
async function createPaymentLink({ amountInRupees, institution, notes: extraNotes }) {
  const c = getClient();
  if (!c) return { ok: false, error: 'Razorpay not configured' };

  const amount = Math.round(Number(amountInRupees) * 100); // paise
  if (!amount || amount <= 0) {
    return { ok: false, error: `Invalid plan price: ${amountInRupees}` };
  }

  // Razorpay rejects reference_id collisions. We add a timestamp so that
  // re-generating a link (e.g. after expiry) gets a fresh, unique ref.
  const referenceId = `inst_${institution.id}_${Date.now()}`;

  try {
    const link = await c.paymentLink.create({
      amount,
      currency: 'INR',
      accept_partial: false,
      // We send our own email, so silence Razorpay's notifications.
      notify: { email: false, sms: false },
      reminder_enable: true,
      description: `Veerify subscription — ${institution.plan_name || 'Plan'} for ${institution.name}`,
      reference_id: referenceId,
      customer: {
        name:    institution.owner_name  || institution.name,
        email:   institution.owner_email || institution.email,
        contact: institution.owner_phone || institution.phone || undefined,
      },
      // The webhook uses notes.institution_id as a back-pointer. We also save
      // the payment_link.id on the row, but notes give us a safety net if a
      // future Razorpay payload shape changes.
      // Callers can attach extra notes (e.g. action, target_plan_id) — those
      // ride alongside the defaults so the webhook can differentiate
      // onboarding / renew / change_plan.
      notes: {
        institution_id: String(institution.id),
        plan_name: institution.plan_name || '',
        ...(extraNotes && typeof extraNotes === 'object' ? extraNotes : {}),
      },
      // Post-payment landing page. Points at the frontend web app —
      // NOT the API. The frontend route renders a friendly "Payment
      // received" confirmation card. In dev when the frontend isn't
      // running, the backend serves a plain fallback HTML at
      // /api/onboarding/payment-success so the payer isn't stranded.
      callback_url: `${WEB_APP_URL}/payment-success?institution_id=${institution.id}`,
      callback_method: 'get',
    });

    return {
      ok: true,
      link: {
        id: link.id,                  // plink_xxx
        short_url: link.short_url,    // https://rzp.io/i/xxxx
        amountPaise: amount,
      },
    };
  } catch (err) {
    // Razorpay SDK errors carry { statusCode, error: { description, ... } }.
    const desc = err?.error?.description || err.message || 'Unknown Razorpay error';
    console.error('[razorpay] createPaymentLink failed:', desc);
    return { ok: false, error: desc };
  }
}

/**
 * Verify the HMAC-SHA256 signature Razorpay sends with every webhook.
 * Razorpay docs: https://razorpay.com/docs/webhooks/validate-test/
 *
 *   rawBody     The exact bytes of the request body (Buffer or string).
 *   signature   Value of the X-Razorpay-Signature header.
 *
 * Returns true if the signature is valid, false otherwise. Uses a constant-time
 * comparison so we don't leak timing info.
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!WEBHOOK_SECRET) {
    console.warn('[razorpay] RAZORPAY_WEBHOOK_SECRET not set — refusing webhook.');
    return false;
  }
  if (!signature || !rawBody) return false;

  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  createPaymentLink,
  verifyWebhookSignature,
};
