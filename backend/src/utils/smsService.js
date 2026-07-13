// backend/src/utils/smsService.js
//
// Thin wrapper around MSG91's transactional SMS API. Powers the welcome
// SMS that fires right after a Student, Trainer, Institution, or Branch
// account is successfully created.
//
// ── Delivery mode ─────────────────────────────────────────────────────
// MSG91 offers two send paths that we support here in priority order:
//
//   1. Flow / DLT template   (recommended for India — TRAI mandates DLT-
//      approved templates for transactional traffic). Uses the /api/v5/
//      flow endpoint. The template body is stored on the MSG91 dashboard
//      and referenced by template_id; we only push the variable values.
//      Activated by setting MSG91_WELCOME_TEMPLATE_ID.
//
//   2. Legacy send-sms API   (raw message body). Uses /api/v2/sendsms.
//      Cheaper to bootstrap because there's no DLT registration in the
//      loop, but you're limited to promotional traffic in prod. Handy
//      for staging / dev where a template hasn't been approved yet.
//      Activated when MSG91_WELCOME_TEMPLATE_ID is empty.
//
// ── Environment variables ────────────────────────────────────────────
// MSG91_AUTHKEY               — required. Your MSG91 account auth key.
// MSG91_SENDER_ID             — 6-char DLT-approved sender header
//                              (e.g. VRFYFY).
// MSG91_WELCOME_TEMPLATE_ID   — DLT template id for the welcome message.
//                              If unset, we fall back to the raw v2 API.
// MSG91_ROUTE                 — v2 route: '4' = transactional (default),
//                              '1' = promotional. Ignored on the flow API.
// MSG91_COUNTRY               — country code without '+' (default '91').
// MSG91_SMS_ENABLED           — set to 'false' to short-circuit the send
//                              (useful in local dev + CI).
//
// ── Failure semantics ────────────────────────────────────────────────
// Every function here returns { ok, ... } and NEVER throws. Callers are
// expected to fire-and-forget so an SMS outage cannot poison the
// registration transaction. Success / failure is logged at info / warn.

const DEFAULT_COUNTRY = '91';
const FLOW_URL         = 'https://control.msg91.com/api/v5/flow/';
const LEGACY_URL       = 'https://api.msg91.com/api/v2/sendsms';

// Node <18 doesn't have global fetch — reach for the polyfill only if
// missing so this file stays zero-config on modern runtimes.
const _fetch = typeof fetch === 'function'
  ? fetch
  : (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// ── Phone normalisation ──────────────────────────────────────────────
// MSG91 wants the country code baked into the "mobiles" field, no '+'.
// The Veerify DB stores raw 10-digit Indian mobiles most of the time,
// but older imports occasionally carry a '+91' or '0' prefix. Normalise
// to <cc><10-digit> so the API always accepts it.
function normaliseMobile(raw, country = DEFAULT_COUNTRY) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D+/g, '');
  if (!digits) return null;
  // Already prefixed with country code (11-13 digits total).
  if (digits.length > 10 && digits.startsWith(country)) return digits;
  // Legacy leading-zero domestic format ("0" + 10 digits).
  if (digits.length === 11 && digits.startsWith('0')) {
    return country + digits.slice(1);
  }
  // Plain 10-digit → prepend cc.
  if (digits.length === 10) return country + digits;
  // Anything else (short codes, non-standard) — pass through best-effort.
  return digits;
}

// ── Kill switch ──────────────────────────────────────────────────────
function _disabled() {
  const flag = String(process.env.MSG91_SMS_ENABLED ?? 'true').toLowerCase();
  return flag === 'false' || flag === '0' || flag === 'no';
}

// ── DLT flow path (preferred) ────────────────────────────────────────
async function _sendViaFlow({ mobiles, templateId, variables }) {
  const body = {
    template_id: templateId,
    short_url:   '0',
    recipients: [
      {
        mobiles,
        // Spread the caller's variables — MSG91's flow API expects
        // whatever variable names the DLT template uses ("name",
        // "otp", "amount", …). Keep raw so we don't force a schema.
        ...(variables || {}),
      },
    ],
  };

  const resp = await _fetch(FLOW_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authkey:        process.env.MSG91_AUTHKEY || '',
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text().catch(() => '');
  if (!resp.ok) {
    return { ok: false, status: resp.status, error: text || resp.statusText };
  }
  return { ok: true, status: resp.status, response: text };
}

// ── v2 raw-message path (fallback) ───────────────────────────────────
async function _sendViaLegacy({ mobiles, message }) {
  const body = {
    sender:  process.env.MSG91_SENDER_ID || 'VEERFY',
    route:   process.env.MSG91_ROUTE     || '4',
    country: process.env.MSG91_COUNTRY   || DEFAULT_COUNTRY,
    sms: [{ message, to: [mobiles] }],
  };

  const resp = await _fetch(LEGACY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authkey:        process.env.MSG91_AUTHKEY || '',
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text().catch(() => '');
  if (!resp.ok) {
    return { ok: false, status: resp.status, error: text || resp.statusText };
  }
  return { ok: true, status: resp.status, response: text };
}

// ── Public: sendSms ──────────────────────────────────────────────────
// Generic send helper. Prefer sendWelcomeSms for the registration flow
// so the message body stays consistent across roles.
async function sendSms({ phone, message, variables }) {
  try {
    if (_disabled()) {
      console.info('[MSG91] short-circuited — MSG91_SMS_ENABLED=false');
      return { ok: true, skipped: true };
    }
    if (!process.env.MSG91_AUTHKEY) {
      console.warn('[MSG91] MSG91_AUTHKEY missing — SMS not sent');
      return { ok: false, error: 'MSG91_AUTHKEY not configured' };
    }
    const mobiles = normaliseMobile(phone);
    if (!mobiles) {
      console.warn('[MSG91] no valid mobile number for send');
      return { ok: false, error: 'Missing / invalid phone number' };
    }

    const templateId = process.env.MSG91_WELCOME_TEMPLATE_ID;
    if (templateId) {
      return await _sendViaFlow({ mobiles, templateId, variables });
    }
    if (!message) {
      return { ok: false, error: 'No template id and no message body' };
    }
    return await _sendViaLegacy({ mobiles, message });
  } catch (err) {
    // Never let the SMS layer take down the caller. Log and swallow.
    console.error('[MSG91] send failed:', err?.message || err);
    return { ok: false, error: err?.message || 'send failed' };
  }
}

// ── Public: sendWelcomeSms ───────────────────────────────────────────
// Fired after any registration completes. Bakes a role-aware body so
// the DLT template can render the same variables regardless of who
// signed up. `tempPassword` is optional — pass it when the account was
// created on the user's behalf (branch admins, admin-created students).
//
// role must be one of: 'student' | 'trainer' | 'institution' | 'branch'
async function sendWelcomeSms({
  phone,
  name,
  role,
  tempPassword,
  loginId,       // usually the email or phone the user will log in with
}) {
  const displayName = String(name || 'there').split(' ')[0];
  const roleLabel   = {
    student:     'Student',
    trainer:     'Trainer',
    institution: 'Institution',
    branch:      'Branch',
  }[role] || 'User';

  // Body used when no DLT template is configured. Keeps under 160 chars
  // per SMS segment where possible so single-part billing applies.
  const parts = [
    `Hi ${displayName}, welcome to Veerify!`,
    `Your ${roleLabel} account is ready.`,
  ];
  if (loginId)      parts.push(`Login: ${loginId}`);
  if (tempPassword) parts.push(`Temp password: ${tempPassword}`);
  parts.push('Login and change your password at your earliest convenience.');
  const message = parts.join(' ');

  // Variables the DLT flow template will receive. MSG91 templates in
  // India typically reference {#var#} placeholders positionally, but
  // most modern DLT templates use named variables. Both are covered:
  const variables = {
    name:          displayName,
    role:          roleLabel,
    login_id:      loginId     || '',
    temp_password: tempPassword || '',
    // Positional aliases so an older DLT template using var1/var2 keeps
    // working without a code change.
    var1: displayName,
    var2: roleLabel,
    var3: loginId     || '',
    var4: tempPassword || '',
  };

  const result = await sendSms({ phone, message, variables });
  if (result.ok && !result.skipped) {
    console.info(`[MSG91] welcome SMS delivered → role=${role} phone=${normaliseMobile(phone)}`);
  } else if (!result.ok) {
    console.warn(`[MSG91] welcome SMS failed → role=${role} phone=${normaliseMobile(phone)} err=${result.error}`);
  }
  return result;
}

// ── Public: dispatchWelcomeSms ───────────────────────────────────────
// Fire-and-forget wrapper. Callers inside the registration flow should
// use THIS one so an SMS provider outage or a slow round-trip cannot
// stall / crash the HTTP response. The underlying promise is caught
// here so an unhandled-rejection can't tear down the process either.
function dispatchWelcomeSms(payload) {
  // setImmediate defers to the next tick so the response goes out first.
  setImmediate(() => {
    sendWelcomeSms(payload).catch((err) => {
      console.error('[MSG91] dispatchWelcomeSms uncaught:', err?.message || err);
    });
  });
}

module.exports = {
  sendSms,
  sendWelcomeSms,
  dispatchWelcomeSms,
  normaliseMobile,
};
