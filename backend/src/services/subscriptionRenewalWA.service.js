// backend/src/services/subscriptionRenewalWA.service.js
//
// "Thanks for renewing" WhatsApp confirmation for institution admins.
// Fires immediately after a successful renewal payment on both hot
// paths that flip a subscription back to active:
//
//   • handlePaymentWebhook (renew / change_plan branch) — the normal
//     path when Razorpay's webhook lands cleanly.
//   • activateInstitutionIfPaid (self-heal, isRenewal=true) — the
//     fallback when the webhook is lost / delayed and the mobile
//     Renew Now button polls verify-payment.
//
// Spec:
//   • Only after a *successful* renewal (never on pending/failed).
//   • Only when the institution's plan has WhatsApp enabled.
//   • Body: thank-you line + plan name + new expiry date + payment
//     reference (when known).
//   • Once per successful renewal transaction — dedup keyed by
//     (institution_id, payment_reference) via migration 088.
//   • Fire-and-forget: any error is logged; never propagates to the
//     renewal / payment path.

const pool = require('../config/db');
const { sendTextMessage } = require('./whatsapp.service');
const { isWhatsAppEnabledForUser } = require('../utils/planFeatureGuard');

function formatExpiryDate(input) {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  return d.toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });
}

function buildBody({ planName, expiryDate, paymentReference }) {
  const lines = [];
  lines.push('Thank you for renewing Veerify! 🎉');
  lines.push('');
  lines.push(
    `Your ${planName ? `*${planName}*` : 'subscription'} `
    + 'has been successfully renewed.',
  );
  if (expiryDate) lines.push(`New expiry date: ${expiryDate}`);
  if (paymentReference) lines.push(`Payment reference: ${paymentReference}`);
  lines.push('');
  lines.push('We appreciate your continued partnership with Veerify.');
  return lines.join('\n');
}

// Reserve a dedup row. If it already exists (another path already
// sent the confirmation for this exact payment), returns false so the
// caller short-circuits without a second WhatsApp POST.
async function reserve(institutionId, paymentReference) {
  try {
    const r = await pool.query(
      `INSERT INTO subscription_renewal_wa
         (institution_id, payment_reference, status)
       VALUES ($1, $2, 'sent')
       ON CONFLICT (institution_id, payment_reference) DO NOTHING
       RETURNING id`,
      [institutionId, paymentReference],
    );
    return r.rowCount > 0;
  } catch (err) {
    if (err?.code === '42P01') {
      console.warn(
        '[renewalWA] subscription_renewal_wa missing — run migration 088. '
        + 'Dedup disabled; the confirmation may fire twice per renewal.',
      );
      return true; // allow send, but log the missing-migration warning
    }
    console.warn('[renewalWA] reserve failed:', err?.message);
    return false;
  }
}

async function stamp(institutionId, paymentReference, patch) {
  try {
    await pool.query(
      `UPDATE subscription_renewal_wa
          SET status     = $3,
              message_id = $4,
              reason     = $5,
              sent_at    = NOW()
        WHERE institution_id    = $1
          AND payment_reference = $2`,
      [
        institutionId,
        paymentReference,
        patch.status,
        patch.messageId || null,
        patch.reason || null,
      ],
    );
  } catch (_) { /* best-effort audit; never fail the caller */ }
}

/**
 * Send the renewal confirmation. Never throws.
 *
 * @param {number} institutionId       – the just-renewed institution's id.
 * @param {object} opts
 *   • paymentReference – Razorpay payment id (or a fallback link id).
 *                        Used as the dedup key. When absent, we skip
 *                        the send entirely — a confirmation without a
 *                        reference can't be de-duplicated safely.
 *   • subscriptionEnd  – Date or ISO string; the NEW expiry.
 *   • planName         – optional; injected into the message body.
 */
async function sendRenewalConfirmationWA(institutionId, opts = {}) {
  try {
    if (!Number.isFinite(Number(institutionId))) return;
    const paymentReference = opts.paymentReference
      ? String(opts.paymentReference)
      : null;
    if (!paymentReference) {
      console.warn(
        `[renewalWA] institution=${institutionId} — skipped, no payment reference.`,
      );
      return;
    }

    // Pull owner + plan info in one query. The renewal branch already
    // has some of this, but re-reading here keeps the helper standalone
    // so future callers don't need to plumb every field through.
    const infoRes = await pool.query(
      `SELECT i.id,
              i.name           AS institution_name,
              i.owner_user_id,
              i.subscription_end,
              u.name           AS owner_name,
              u.phone          AS owner_phone,
              sp.name          AS plan_name
         FROM institutions i
         JOIN users u                    ON u.id = i.owner_user_id
         LEFT JOIN subscription_plans sp ON sp.id = i.plan_id
        WHERE i.id = $1
          AND i.deleted_at IS NULL
        LIMIT 1`,
      [institutionId],
    );
    const info = infoRes.rows[0];
    if (!info || !info.owner_user_id || !info.owner_phone) return;

    // Plan gate — false when WhatsApp isn't included, or on any lookup
    // error (fail-closed inside isWhatsAppEnabledForUser).
    const enabled = await isWhatsAppEnabledForUser(info.owner_user_id);
    if (!enabled) return;

    // Dedup by payment reference. Reservation → false means another
    // path already fired the confirmation for this exact transaction.
    const reserved = await reserve(institutionId, paymentReference);
    if (!reserved) return;

    const body = buildBody({
      planName:         opts.planName || info.plan_name || null,
      expiryDate:       formatExpiryDate(opts.subscriptionEnd || info.subscription_end),
      paymentReference,
    });

    const send = await sendTextMessage(info.owner_phone, body);
    if (send.ok) {
      await stamp(institutionId, paymentReference, {
        status: 'sent',
        messageId: send.messageId || null,
      });
      console.log(
        `[renewalWA] institution=${institutionId} sent messageId=${send.messageId || 'n/a'} `
        + `payment=${paymentReference}`,
      );
    } else {
      await stamp(institutionId, paymentReference, {
        status: 'failed',
        reason: send.error || 'send-failed',
      });
      console.warn(
        `[renewalWA] institution=${institutionId} send failed: ${send.error} `
        + `payment=${paymentReference}`,
      );
    }
  } catch (err) {
    // Absolutely swallow — the caller has already committed the
    // renewal and MUST NOT receive a 500 because WhatsApp had a bad
    // day. Renewal / payment processing stays clean.
    console.warn('[renewalWA] sendRenewalConfirmationWA failed:', err?.message);
  }
}

module.exports = { sendRenewalConfirmationWA };
