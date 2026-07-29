// backend/src/services/subscriptionExpiry.service.js
//
// Post-expiry lifecycle scheduler.
//
// State machine (institutions.subscription_status):
//
//   active  ─────(paid_at + billing_cycle < NOW())────► expired
//   expired ───(paid_at + billing_cycle + 3d < NOW())─► inactive
//   any     ────(fresh renewal: paid_at just moved)───► active
//
// The scheduler runs hourly (overridable via
// SUBSCRIPTION_EXPIRY_TICK_MS for QA) and only writes when a row's
// computed state disagrees with what's stored. Each tick is
// idempotent — a rerun on the same second changes nothing.
//
// Renewal detection: when subscription_status IN ('expired',
// 'inactive') and paid_at has moved so paid_at + billing_cycle
// is now IN THE FUTURE, we treat that as a renewal and flip back
// to 'active'. The existing payment webhook (see
// onboarding.controller handlePaymentWebhook) does the paid_at
// bump on successful payment; this scheduler is what un-locks
// the account on the next tick without needing the webhook to
// know about grace state.

const pool = require('../config/db');

const GRACE_DAYS = 3;

const TICK_MS = (() => {
  const raw = Number(process.env.SUBSCRIPTION_EXPIRY_TICK_MS);
  if (Number.isFinite(raw) && raw >= 5000) return raw;
  return 60 * 60 * 1000; // 1 hour
})();

let timer = null;
let running = false;
let schemaMissing = false;

/**
 * One SQL scan that returns every institution whose stored state
 * disagrees with what its dates say. The compute happens inside SQL
 * so we don't marshal rows through JS just to filter. Uses the
 * billing_cycle on the plan (monthly / yearly) with a fallback to
 * monthly for legacy rows.
 */
async function findMismatched() {
  const r = await pool.query(
    `WITH scoped AS (
       SELECT
         i.id,
         i.name,
         i.subscription_status,
         i.status               AS institution_status,
         i.paid_at,
         i.subscription_end,
         COALESCE(sp.billing_cycle, 'monthly') AS billing_cycle,
         -- Prefer explicit subscription_end when the approve /
         -- payment flow wrote one; otherwise fall back to
         -- paid_at + billing_cycle. Keeps legacy rows (created
         -- before paid_at was always written) correctly scanned.
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
       LEFT JOIN subscription_plans sp ON sp.id = i.plan_id
       -- Both 'approved' (just approved, awaiting pay OR trial) and
       -- 'active' (paid + live) need lifecycle evaluation. The old
       -- filter only checked 'approved' which meant paid + active
       -- institutions were never rescanned so they stayed labelled
       -- Active even after their subscription_end passed.
       WHERE i.onboarding_status IN ('approved', 'active')
         AND i.deleted_at IS NULL
     )
     SELECT
       id, name, subscription_status, institution_status, paid_at,
       renewal_at,
       (renewal_at + INTERVAL '${GRACE_DAYS} days') AS grace_ends_at,
       -- desired_status is what the row SHOULD carry based on now vs
       -- renewal_at + grace window. We consult renewal_at (either
       -- subscription_end or paid_at + cycle) instead of paid_at so
       -- rows with a set subscription_end but no paid_at still evaluate.
       CASE
         WHEN renewal_at IS NULL                                THEN subscription_status
         WHEN NOW() < renewal_at                                THEN 'active'
         WHEN NOW() < renewal_at + INTERVAL '${GRACE_DAYS} days' THEN 'expired'
         ELSE 'inactive'
       END AS desired_status
     FROM scoped
     WHERE
       -- Only rows whose stored state disagrees with desired.
       (
         CASE
           WHEN renewal_at IS NULL                                THEN subscription_status
           WHEN NOW() < renewal_at                                THEN 'active'
           WHEN NOW() < renewal_at + INTERVAL '${GRACE_DAYS} days' THEN 'expired'
           ELSE 'inactive'
         END
       ) <> subscription_status`,
  );
  return r.rows;
}

// Latch set the first time an UPDATE hits the pre-078 CHECK
// constraint on institutions.status. Once flipped, tick() short-
// circuits so a stale schema doesn't fill logs on every hourly
// scan. The moment migration 078 lands + the process restarts,
// this flag resets and the scheduler resumes normal operation.
let statusConstraintTight = false;

async function applyTransition(row) {
  const { id, subscription_status: from, desired_status: to } = row;
  if (from === to) return;

  // Compose the UPDATE per transition so the audit fields (status,
  // subscription_expired_at) move together with subscription_status.
  //
  //   active  → expired  : stamp subscription_expired_at = NOW().
  //                        Keep institution.status = 'approved' so
  //                        login stays available during grace.
  //   expired → inactive : flip institution.status = 'inactive' so
  //                        the login gate refuses these accounts.
  //                        subscription_expired_at unchanged.
  //   * → active         : clear subscription_expired_at, restore
  //                        institution.status to 'approved'.
  const patches = [];
  const params  = [id];
  patches.push(`subscription_status = '${to}'`);

  if (to === 'expired') {
    patches.push(`subscription_expired_at = COALESCE(subscription_expired_at, NOW())`);
  }
  if (to === 'inactive') {
    patches.push(`status = 'inactive'`);
  }
  if (to === 'active') {
    patches.push(`subscription_expired_at = NULL`);
    patches.push(`status = 'approved'`);
  }

  await pool.query(
    `UPDATE institutions SET ${patches.join(', ')}, updated_at = NOW() WHERE id = $1`,
    params,
  );
  console.log(
    `[subscriptionExpiry] institution=${id} (${row.name}) transition ${from} → ${to}`,
  );
}

async function tick() {
  if (running || schemaMissing || statusConstraintTight) return;
  running = true;
  try {
    const rows = await findMismatched();
    if (rows.length === 0) return;
    console.log(`[subscriptionExpiry] tick — ${rows.length} transition(s)`);
    for (const row of rows) {
      try { await applyTransition(row); }
      catch (err) {
        // 23514 = check_violation. This fires on a pre-078 schema
        // where institutions.status still rejects 'inactive'. Latch
        // the flag so the scheduler stops re-scanning every tick
        // (each attempt would produce the same row set with the
        // same violations, filling logs).
        if (err?.code === '23514' && /institutions_status_check/i.test(err?.constraint || err?.message || '')) {
          statusConstraintTight = true;
          console.warn(
            '[subscriptionExpiry] disabled — migration 078_institutions_status_inactive.sql has not been applied. '
            + 'Run `npm run migrate -- src/db/migrations/078_institutions_status_inactive.sql` and restart the server.',
          );
          break;
        }
        console.warn(`[subscriptionExpiry] apply failed id=${row.id}:`, err?.message);
      }
    }
  } catch (err) {
    if (err?.code === '42703' || /column .* does not exist/i.test(err?.message || '')) {
      schemaMissing = true;
      console.warn(
        '[subscriptionExpiry] disabled — migration 075_subscription_expiry_grace.sql has not been applied. ' +
        'Run `npm run migrate -- src/db/migrations/075_subscription_expiry_grace.sql` and restart the server.',
      );
    } else {
      console.warn('[subscriptionExpiry] tick failed:', err?.message);
    }
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  // First tick shortly after boot so any state that's already
  // stale (post-migration first-run, or a server that was down
  // when a grace window closed) gets reconciled quickly.
  setTimeout(() => { tick(); }, 30_000);
  timer = setInterval(() => { tick(); }, TICK_MS);
  console.log(
    `[subscriptionExpiry] scheduler started — tick every ${TICK_MS} ms, grace window ${GRACE_DAYS} days`,
  );
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, GRACE_DAYS };
