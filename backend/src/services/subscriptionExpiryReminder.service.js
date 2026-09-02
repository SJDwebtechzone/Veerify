// backend/src/services/subscriptionExpiryReminder.service.js
//
// Subscription-expiry WhatsApp reminder scheduler.
//
// Spec:
//   • Send a WhatsApp reminder to the institution admin on each of the
//     three days before subscription_end: T-3, T-2, T-1.
//   • Only when the institution's plan has WhatsApp enabled.
//   • Include plan name, expiry date, remaining days, renewal link.
//   • Never send two reminders on the same day for the same cycle.
//   • Renewal moves subscription_end forward → a NEW reminder cycle
//     starts automatically (dedup rows are keyed by subscription_end).
//   • WhatsApp failure MUST NOT affect any subscription / payment
//     processing — every error is caught, logged, and dropped.
//
// Storage:
//   subscription_expiry_wa_reminders (institution_id, subscription_end,
//     days_before, ...) — see migration 087. The UNIQUE constraint on
//     (institution_id, subscription_end, days_before) is what enforces
//     both same-day dedup AND "new cycle after renewal".
//
// Tick cadence:
//   Hourly by default; overridable via SUBSCRIPTION_EXPIRY_REMINDER_TICK_MS.
//   The tick is idempotent — reruns pick up new rows and skip already-
//   sent ones via the unique constraint.

const pool = require('../config/db');
const { sendTextMessage } = require('./whatsapp.service');
const { isWhatsAppEnabledForUser } = require('../utils/planFeatureGuard');
const { createPaymentLink } = require('../utils/razorpay');

const REMIND_DAYS = [3, 2, 1];

const TICK_MS = (() => {
  const raw = Number(process.env.SUBSCRIPTION_EXPIRY_REMINDER_TICK_MS);
  if (Number.isFinite(raw) && raw >= 5000) return raw;
  return 60 * 60 * 1000; // 1 hour
})();

let timer = null;
let running = false;
let schemaMissing = false;

// ─────────────────────────────────────────────────────────────────────
// Candidate resolution.
//
// Grab every active-subscription institution whose renewal date sits
// in the next 3 days. renewal_at is computed the same way as the
// subscriptionExpiry scheduler: prefer subscription_end if set, else
// paid_at + billing_cycle. We also select the owner and plan fields
// the message body needs, in a single query.
async function findCandidates() {
  const r = await pool.query(
    `WITH scoped AS (
       SELECT
         i.id,
         i.name                                     AS institution_name,
         i.owner_user_id,
         i.paid_at,
         i.subscription_status,
         i.payment_link_id,
         i.payment_link_url,
         u.name    AS owner_name,
         u.email   AS owner_email,
         u.phone   AS owner_phone,
         sp.id     AS plan_id,
         sp.name   AS plan_name,
         sp.price  AS plan_price,
         COALESCE(sp.billing_cycle, 'monthly') AS billing_cycle,
         sp.discount_enabled AS plan_discount_enabled,
         sp.discount_percent AS plan_discount_percent,
         COALESCE(
           i.subscription_end,
           CASE
             WHEN i.paid_at IS NULL THEN NULL
             WHEN LOWER(COALESCE(sp.billing_cycle, 'monthly')) = 'yearly'
               THEN i.paid_at + INTERVAL '1 year'
             ELSE i.paid_at + INTERVAL '1 month'
           END
         ) AS renewal_at
       FROM institutions i
       JOIN users u                    ON u.id = i.owner_user_id
       LEFT JOIN subscription_plans sp ON sp.id = i.plan_id
      WHERE i.onboarding_status IN ('approved', 'active')
        AND i.deleted_at IS NULL
        AND COALESCE(i.subscription_status, 'active') = 'active'
        AND i.parent_institution_id IS NULL
     )
     SELECT *
       FROM scoped
      WHERE renewal_at IS NOT NULL
        AND renewal_at >  NOW()
        AND renewal_at <= NOW() + INTERVAL '3 days'
      ORDER BY renewal_at ASC`,
  );
  return r.rows;
}

// Days between now and the renewal date, rounded UP so the last few
// minutes of "day X" still bucket into X. 3 → send T-3 today. Values
// outside the {1,2,3} window are ignored by the caller.
function daysUntil(renewalAt) {
  const ms = new Date(renewalAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function formatExpiryDate(renewalAt) {
  try {
    return new Date(renewalAt).toLocaleDateString('en-IN', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return String(renewalAt || ''); }
}

function buildBody({ institutionName, planName, expiryDate, daysLeft, paymentUrl }) {
  const lines = [];
  lines.push('⚠️ Your Veerify subscription is about to expire.');
  lines.push('');
  if (institutionName) lines.push(`Academy: *${institutionName}*`);
  if (planName)        lines.push(`Plan: ${planName}`);
  lines.push(`Expires: ${expiryDate}`);
  lines.push(`Time left: ${daysLeft} day${daysLeft === 1 ? '' : 's'}`);
  lines.push('');
  if (paymentUrl) {
    lines.push('Renew now to avoid any service interruption:');
    lines.push(paymentUrl);
  } else {
    lines.push('Open the Veerify Institution app → More → Pricing & Plans → Renew Now.');
  }
  lines.push('');
  lines.push('This is an automated reminder — you\'ll receive one each day until you renew.');
  return lines.join('\n');
}

// Ensure the institution has a Razorpay payment link so the WhatsApp
// message can carry a tap-to-pay URL. Reuses the existing helper the
// trial reminder path uses. Best-effort — a mint failure just falls
// back to the app-flow instructions in the message body.
async function ensurePaymentLink(row) {
  if (row.payment_link_url && row.payment_link_id) return row.payment_link_url;
  try {
    const basePrice   = Number(row.plan_price) || 0;
    const discountOn  = !!row.plan_discount_enabled;
    const discountPct = Number(row.plan_discount_percent) || 0;
    const effective   = discountOn && discountPct > 0
      ? Math.round(basePrice * (1 - discountPct / 100))
      : basePrice;
    if (!effective || effective <= 0) return null;
    const link = await createPaymentLink({
      amountInRupees: effective,
      institution: {
        id:          row.id,
        name:        row.institution_name,
        owner_email: row.owner_email,
        owner_phone: row.owner_phone,
        owner_name:  row.owner_name,
      },
    });
    if (!link.ok || !link.link) return null;
    // Persist so the next reminder / the mobile Renew Now flow can
    // reuse the same link instead of minting a fresh one.
    await pool.query(
      `UPDATE institutions SET
         payment_link_id     = $1,
         payment_link_url    = $2,
         payment_link_status = 'pending',
         payment_amount      = $3
       WHERE id = $4`,
      [link.link.id, link.link.short_url, link.link.amountPaise, row.id],
    );
    return link.link.short_url;
  } catch (err) {
    console.warn('[expiryReminder] payment link mint failed:', err?.message);
    return null;
  }
}

// Reserve a dedup row up front. The composite UNIQUE constraint on
// (institution_id, subscription_end, days_before) is what enforces
// "one reminder per day per cycle". Returns true when the reservation
// took (fresh send) and false when a prior row exists (skip).
async function reserveReminder(institutionId, subscriptionEndIsoDate, daysBefore) {
  try {
    const r = await pool.query(
      `INSERT INTO subscription_expiry_wa_reminders
         (institution_id, subscription_end, days_before, status)
       VALUES ($1, $2::date, $3, 'sent')
       ON CONFLICT (institution_id, subscription_end, days_before)
       DO NOTHING
       RETURNING id`,
      [institutionId, subscriptionEndIsoDate, daysBefore],
    );
    return r.rowCount > 0;
  } catch (err) {
    if (err?.code === '42P01') {
      schemaMissing = true;
      console.warn(
        '[expiryReminder] disabled — migration 087_subscription_expiry_wa_reminders.sql not applied. '
        + 'Run the migration and restart the server.',
      );
      return false;
    }
    console.warn('[expiryReminder] reserve failed:', err?.message);
    return false;
  }
}

async function stampOutcome(institutionId, subscriptionEndIsoDate, daysBefore, patch) {
  try {
    await pool.query(
      `UPDATE subscription_expiry_wa_reminders
          SET status = $4,
              message_id = $5,
              reason = $6,
              sent_at = NOW()
        WHERE institution_id  = $1
          AND subscription_end = $2::date
          AND days_before     = $3`,
      [
        institutionId,
        subscriptionEndIsoDate,
        daysBefore,
        patch.status,
        patch.messageId || null,
        patch.reason || null,
      ],
    );
  } catch (_) { /* best-effort audit */ }
}

async function processCandidate(row) {
  const daysLeft = daysUntil(row.renewal_at);
  if (!daysLeft || !REMIND_DAYS.includes(daysLeft)) return;
  if (!row.owner_user_id || !row.owner_phone) return;

  // Plan gate — checked against the OWNER admin's institution walk.
  const enabled = await isWhatsAppEnabledForUser(row.owner_user_id);
  if (!enabled) return;

  // Same-day dedup via unique constraint keyed on subscription_end
  // truncated to a DATE. A renewal that pushes subscription_end
  // forward yields a fresh key set → the next cycle's reminders fire.
  const subEndIso = new Date(row.renewal_at).toISOString().slice(0, 10);
  const reserved = await reserveReminder(row.id, subEndIso, daysLeft);
  if (!reserved) return;

  const paymentUrl = await ensurePaymentLink(row);

  const body = buildBody({
    institutionName: row.institution_name,
    planName:        row.plan_name || null,
    expiryDate:      formatExpiryDate(row.renewal_at),
    daysLeft,
    paymentUrl:      paymentUrl || null,
  });

  const send = await sendTextMessage(row.owner_phone, body);
  if (send.ok) {
    await stampOutcome(row.id, subEndIso, daysLeft, {
      status: 'sent',
      messageId: send.messageId || null,
    });
    console.log(
      `[expiryReminder] institution=${row.id} (${row.institution_name}) `
      + `T-${daysLeft} → sent messageId=${send.messageId || 'n/a'}`,
    );
  } else {
    await stampOutcome(row.id, subEndIso, daysLeft, {
      status: 'failed',
      reason: send.error || 'send-failed',
    });
    console.warn(
      `[expiryReminder] institution=${row.id} T-${daysLeft} → send failed: ${send.error}`,
    );
  }
}

async function tick() {
  if (running || schemaMissing) return;
  running = true;
  try {
    const rows = await findCandidates();
    if (rows.length === 0) return;
    console.log(`[expiryReminder] tick — ${rows.length} candidate(s)`);
    for (const row of rows) {
      try { await processCandidate(row); }
      catch (err) {
        // Never let one row abort the tick — subscription/payment
        // processing must not be affected by a WA failure.
        console.warn(
          `[expiryReminder] processCandidate failed id=${row.id}: ${err?.message}`,
        );
      }
    }
  } catch (err) {
    if (err?.code === '42703' || /column .* does not exist/i.test(err?.message || '')) {
      schemaMissing = true;
      console.warn(
        '[expiryReminder] disabled — an earlier subscription migration is missing. '
        + 'Ensure 075 and 087 have been applied and restart the server.',
      );
    } else {
      console.warn('[expiryReminder] tick failed:', err?.message);
    }
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  setTimeout(() => { tick(); }, 45_000);
  timer = setInterval(() => { tick(); }, TICK_MS);
  console.log(
    `[expiryReminder] scheduler started — tick every ${TICK_MS} ms, `
    + `remind on T-${REMIND_DAYS.join(', T-')}`,
  );
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, REMIND_DAYS };
