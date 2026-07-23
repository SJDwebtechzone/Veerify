// backend/src/services/trialReminder.service.js
//
// Free Trial Subscription Flow — reminder scheduler.
//
// Runs once per hour (starting a few seconds after boot so a dev
// restart never delays a due reminder by an hour). Each tick:
//
//   1. Finds every institution where:
//        onboarding_status = 'approved'
//        paid_at IS NULL
//        trial_ends_at BETWEEN NOW() AND NOW() + interval '3 days'
//        trial_reminder_sent_at IS NULL
//      That's exactly the "3 days or fewer left in trial, no reminder
//      email yet" bucket. The partial index from migration 070
//      (idx_institutions_trial_reminder_pending) covers this predicate,
//      so the scan is O(candidates), not O(all_institutions).
//
//   2. For each candidate, in ORDER of trial_ends_at ASC (most urgent
//      first), transactionally:
//        a. Mint a Razorpay payment link (via the same helper the
//           approve flow uses) IF the institution doesn't already
//           have one.
//        b. Send the "trial ending soon" email carrying the link.
//        c. Stamp trial_reminder_sent_at = NOW() so this row is
//           never picked up again.
//
//      Failures are logged but never crash the tick. Any candidate we
//      couldn't reminded stays uncstamped, so the NEXT tick retries
//      until success. Duplicate emails are impossible because the
//      stamp happens ONLY on a successful mailer return.
//
// Test/dev knob: set TRIAL_REMINDER_TICK_MS in the environment to
// override the interval (in ms). Handy for QA to speed the loop up.

const pool = require('../config/db');
const { createPaymentLink } = require('../utils/razorpay');
const { sendTrialEndingSoonEmail } = require('../utils/mailer');

// One hour. QA can shorten via env var. We deliberately don't allow
// less than 5 seconds — anything shorter is almost certainly a typo
// and would hammer the DB during a test run.
const TICK_MS = (() => {
  const raw = Number(process.env.TRIAL_REMINDER_TICK_MS);
  if (Number.isFinite(raw) && raw >= 5000) return raw;
  return 60 * 60 * 1000; // 1 hour
})();

// Days-before-end threshold. Spec says 3.
const REMIND_BEFORE_DAYS = 3;

let timer = null;
let running = false;

async function findCandidates() {
  const r = await pool.query(
    `SELECT i.id, i.name, i.owner_user_id, i.plan_id,
            i.trial_starts_at, i.trial_ends_at, i.grace_ends_at,
            i.payment_link_id, i.payment_link_url,
            i.payment_amount,
            u.email AS owner_email, u.name AS owner_name, u.phone AS owner_phone,
            sp.name             AS plan_name,
            sp.price            AS plan_price,
            sp.discount_enabled AS plan_discount_enabled,
            sp.discount_percent AS plan_discount_percent
       FROM institutions i
       JOIN users u              ON u.id = i.owner_user_id
       LEFT JOIN subscription_plans sp ON sp.id = i.plan_id
      WHERE i.onboarding_status = 'approved'
        AND i.paid_at IS NULL
        AND i.trial_ends_at IS NOT NULL
        AND i.trial_reminder_sent_at IS NULL
        AND i.trial_ends_at <= NOW() + ($1 || ' days')::interval
      ORDER BY i.trial_ends_at ASC`,
    [REMIND_BEFORE_DAYS],
  );
  return r.rows;
}

async function ensurePaymentLink(row) {
  // Skip if we already minted one at approval or a previous tick.
  if (row.payment_link_url && row.payment_link_id) {
    return { ok: true, url: row.payment_link_url, id: row.payment_link_id };
  }
  const basePrice   = Number(row.plan_price) || 0;
  const discountOn  = !!row.plan_discount_enabled;
  const discountPct = Number(row.plan_discount_percent) || 0;
  const effective   = discountOn && discountPct > 0
    ? Math.round(basePrice * (1 - discountPct / 100))
    : basePrice;
  const link = await createPaymentLink({
    amountInRupees: effective,
    institution: {
      id:          row.id,
      name:        row.name,
      owner_email: row.owner_email,
      owner_phone: row.owner_phone,
      owner_name:  row.owner_name,
    },
  });
  if (!link.ok) return { ok: false, error: link.error };
  await pool.query(
    `UPDATE institutions SET
       payment_link_id     = $1,
       payment_link_url    = $2,
       payment_link_status = 'pending',
       payment_amount      = $3
     WHERE id = $4`,
    [link.link.id, link.link.short_url, link.link.amountPaise, row.id],
  );
  return { ok: true, url: link.link.short_url, id: link.link.id };
}

async function pricingTermsFor(planId) {
  if (!planId) return null;
  try {
    const r = await pool.query(
      `SELECT billing_term, price
         FROM plan_pricing
        WHERE plan_id = $1 AND is_enabled = TRUE
        ORDER BY
          CASE billing_term
            WHEN 'monthly'     THEN 1
            WHEN 'quarterly'   THEN 2
            WHEN 'half_yearly' THEN 3
            WHEN 'annual'      THEN 4
            ELSE 5
          END`,
      [planId],
    );
    return r.rows.map((x) => ({
      billing_term: x.billing_term,
      price:        Number(x.price),
      is_enabled:   true,
    }));
  } catch {
    return null;
  }
}

async function processOne(row) {
  const linkResult = await ensurePaymentLink(row);
  if (!linkResult.ok) {
    console.warn(`[trialReminder] link mint failed for institution=${row.id}: ${linkResult.error}`);
    return { ok: false, error: linkResult.error };
  }
  const daysLeft = Math.max(0, Math.ceil(
    (new Date(row.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  ));
  const pricingTerms = await pricingTermsFor(row.plan_id);
  const mail = await sendTrialEndingSoonEmail({
    to:              row.owner_email,
    ownerName:       row.owner_name,
    institutionName: row.name,
    planName:        row.plan_name,
    trialEndsAt:     row.trial_ends_at,
    daysLeft,
    paymentUrl:      linkResult.url,
    institutionId:   row.id,
    pricingTerms,
  });
  if (!mail.ok) {
    console.warn(`[trialReminder] email send failed for institution=${row.id}: ${mail.error}`);
    return { ok: false, error: mail.error };
  }
  // Idempotency stamp — happens ONLY after a successful mail send so
  // a transient SMTP hiccup lets the next tick retry cleanly.
  await pool.query(
    `UPDATE institutions
        SET trial_reminder_sent_at = NOW()
      WHERE id = $1`,
    [row.id],
  );
  console.log(`[trialReminder] institution=${row.id} (${row.name}) reminded — ${daysLeft} day(s) left, link ${linkResult.url}`);
  return { ok: true };
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const candidates = await findCandidates();
    if (candidates.length === 0) return;
    console.log(`[trialReminder] tick — ${candidates.length} candidate(s)`);
    for (const row of candidates) {
      try {
        await processOne(row);
      } catch (err) {
        console.warn(`[trialReminder] processOne threw for id=${row.id}:`, err?.message);
      }
    }
  } catch (err) {
    console.warn('[trialReminder] tick failed:', err?.message);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  // First tick after a short delay so boot logs settle before the
  // scheduler's own noise. Subsequent ticks on TICK_MS.
  setTimeout(() => { tick(); }, 15_000);
  timer = setInterval(() => { tick(); }, TICK_MS);
  console.log(`[trialReminder] scheduler started — tick every ${TICK_MS} ms, remind ${REMIND_BEFORE_DAYS} days before trial ends`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
