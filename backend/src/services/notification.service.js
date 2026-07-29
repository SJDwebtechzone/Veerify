// backend/src/services/notification.service.js
//
// Reusable FCM push helper. Every caller (insertNotification fan-out,
// scheduled tasks, ad-hoc admin broadcasts) goes through here so
// invalid-token handling stays in one place.
//
// Public API:
//   sendToUsers({ userIds, title, body, data })
//     → resolves tokens from fcm_tokens for those users, sends,
//       prunes bad tokens.
//
//   sendToTokens({ tokens, title, body, data })
//     → send to a specific token list (used internally + when you
//       already have a token from a fresh register call).
//
// `data` is a plain object; it's stringified into FCM's data map
// (all string values, per FCM protocol). The mobile bootstrap reads
// `data.screen`, `data.params` etc. to decide where to navigate on
// tap. Standard keys we use across the app:
//   screen  — target route name in the mobile navigator
//   params  — JSON-stringified route params
//   category — original in-app category (announcement/attendance/…)
//   notification_id — id of the in-app notifications row
//
// Failure semantics: never throws. Every send returns
// { ok, success_count, failure_count, invalid_tokens }.

const pool = require('../config/db');
const { getMessaging } = require('../config/firebase');

const CHUNK = 400; // Firebase's per-request cap is 500 for
                   // sendEachForMulticast — stay under it.

function normaliseDataMap(data) {
  if (!data || typeof data !== 'object') return {};
  const out = {};
  Object.entries(data).forEach(([k, v]) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') { out[k] = v; return; }
    if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = String(v);
      return;
    }
    // Arrays / plain objects — JSON-stringify. Mobile side parses
    // known keys back out (e.g. params).
    try { out[k] = JSON.stringify(v); } catch { /* skip */ }
  });
  return out;
}

// Firebase reports invalid / stale tokens with specific error codes.
// We prune those from the DB so the next send doesn't waste an API
// call — the mobile will re-register on next launch anyway.
const INVALID_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'messaging/mismatched-credential',
]);

async function pruneInvalidTokens(tokens) {
  if (!tokens || tokens.length === 0) return;
  try {
    await pool.query(
      `DELETE FROM fcm_tokens WHERE token = ANY($1::text[])`,
      [tokens],
    );
    console.log(`[notification] pruned ${tokens.length} invalid FCM token(s)`);
  } catch (err) {
    if (err?.code !== '42P01') {
      console.warn('[notification] pruneInvalidTokens failed:', err?.message);
    }
  }
}

async function tokensForUsers(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  try {
    const r = await pool.query(
      `SELECT DISTINCT token FROM fcm_tokens WHERE user_id = ANY($1::int[])`,
      [userIds],
    );
    return r.rows.map((row) => row.token).filter(Boolean);
  } catch (err) {
    if (err?.code === '42P01') {
      // migration 080 not yet applied
      return [];
    }
    console.warn('[notification] tokensForUsers failed:', err?.message);
    return [];
  }
}

async function sendToTokens({ tokens, title, body, data }) {
  const messaging = getMessaging();
  if (!messaging) {
    return { ok: false, skipped: 'firebase-not-configured', success_count: 0, failure_count: 0 };
  }
  const clean = Array.from(new Set((tokens || []).filter(Boolean)));
  if (clean.length === 0) {
    return { ok: true, skipped: 'no-tokens', success_count: 0, failure_count: 0 };
  }

  const dataMap = normaliseDataMap(data);
  let totalSuccess = 0;
  let totalFailure = 0;
  const invalidTokens = [];

  // FCM caps per-batch at 500 tokens. We chunk to stay safe and to
  // parallelise a bit for large fan-outs.
  for (let i = 0; i < clean.length; i += CHUNK) {
    const batch = clean.slice(i, i + CHUNK);
    try {
      const res = await messaging.sendEachForMulticast({
        tokens: batch,
        notification: {
          title: title || 'Veerify',
          body:  body  || '',
        },
        data: dataMap,
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
        apns: {
          payload: { aps: { sound: 'default' } },
        },
      });
      totalSuccess += res.successCount || 0;
      totalFailure += res.failureCount || 0;
      (res.responses || []).forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          const code = resp.error.code || '';
          if (INVALID_ERROR_CODES.has(code)) {
            invalidTokens.push(batch[idx]);
          } else {
            console.warn(
              `[notification] FCM send failure code=${code} msg=${resp.error.message}`,
            );
          }
        }
      });
    } catch (err) {
      totalFailure += batch.length;
      console.warn('[notification] sendEachForMulticast threw:', err?.message);
    }
  }

  if (invalidTokens.length > 0) {
    // Fire-and-forget prune so the caller's happy-path stays fast.
    pruneInvalidTokens(invalidTokens).catch(() => {});
  }

  return {
    ok: totalFailure === 0,
    success_count: totalSuccess,
    failure_count: totalFailure,
    invalid_tokens: invalidTokens,
  };
}

async function sendToUsers({ userIds, title, body, data }) {
  const tokens = await tokensForUsers(userIds);
  if (tokens.length === 0) {
    return { ok: true, skipped: 'no-tokens-for-users', success_count: 0, failure_count: 0 };
  }
  return sendToTokens({ tokens, title, body, data });
}

// Convenience wrapper for the insertNotification fan-out — takes a
// notification row shape ({ user_id, title, message, data, category,
// id }) and pushes it to the row's owner. Fire-and-forget from the
// caller; the promise resolution is logged for observability.
function fanOutFromNotificationRow(row) {
  if (!row || !row.user_id) return Promise.resolve({ ok: false, skipped: 'no-row' });
  const dataMap = { ...(row.data || {}) };
  if (row.category && !dataMap.category) dataMap.category = row.category;
  if (row.id && !dataMap.notification_id) dataMap.notification_id = row.id;
  return sendToUsers({
    userIds: [row.user_id],
    title:   row.title,
    body:    row.message || '',
    data:    dataMap,
  })
    .then((r) => {
      if (r.skipped) {
        console.log(
          `[notification] push skipped user=${row.user_id} reason=${r.skipped}`,
        );
      } else {
        console.log(
          `[notification] push sent user=${row.user_id} ok=${r.ok} `
          + `success=${r.success_count} fail=${r.failure_count} `
          + `invalid=${(r.invalid_tokens || []).length}`,
        );
      }
      return r;
    })
    .catch((err) => {
      console.warn('[notification] fan-out threw:', err?.message);
      return { ok: false, error: err?.message };
    });
}

module.exports = {
  sendToUsers,
  sendToTokens,
  fanOutFromNotificationRow,
};
