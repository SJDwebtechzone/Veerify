// backend/src/utils/contactValidation.js
//
// Single source of truth for email + phone validation across every
// "create a user" endpoint:
//   - POST /auth/register          (public sign-up)
//   - POST /enrollments  admin-mode (admin enrols a student)
//   - POST /trainers               (admin creates a trainer)
//   - PUT  /trainers/:id           (admin edits a trainer)
//
// Two layers of defence per field:
//   1. Format check — regex + length, returns 400 with a friendly message
//   2. Uniqueness  — case-insensitive lookup against users.email / users.phone,
//                    returns 409 with { code: 'EMAIL_TAKEN' | 'PHONE_TAKEN', field, message }
//
// All endpoints get the same error shape so the mobile only has to read
// `err.response.data.field` and `err.response.data.message`.

const pool = require('../config/db');

// Permissive but real-world-safe email regex. Refuses spaces, requires an
// @ and a TLD-like suffix. We intentionally don't try to be RFC-perfect —
// the bar is "is this a plausible login" not "is this routable".
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Indian-style 10-digit phone with optional leading +91 / 91 / 0. We strip
// the prefix and validate the trailing 10 digits start with 6-9 (mobile
// range — landlines start with 2-5 but those don't belong here).
const PHONE_RX = /^[6-9]\d{9}$/;

function normaliseEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function normalisePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  // Strip common prefixes so 9876543210, 919876543210, 09876543210 all match.
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0'))  return digits.slice(1);
  return digits;
}

// ── Format validators ─────────────────────────────────────────────────
function validateEmailFormat(rawEmail, { required = true } = {}) {
  const email = normaliseEmail(rawEmail);
  if (!email) {
    if (required) {
      return { ok: false, status: 400, body: { field: 'email', message: 'Email is required.' } };
    }
    return { ok: true, value: null };
  }
  if (!EMAIL_RX.test(email)) {
    return {
      ok: false, status: 400,
      body: { field: 'email', message: 'Please enter a valid email address (e.g. you@example.com).' },
    };
  }
  return { ok: true, value: email };
}

function validatePhoneFormat(rawPhone, { required = false } = {}) {
  const phone = normalisePhone(rawPhone);
  if (!phone) {
    if (required) {
      return { ok: false, status: 400, body: { field: 'phone', message: 'Contact number is required.' } };
    }
    return { ok: true, value: null };
  }
  if (!PHONE_RX.test(phone)) {
    return {
      ok: false, status: 400,
      body: {
        field: 'phone',
        message: 'Please enter a valid 10-digit mobile number starting with 6-9.',
      },
    };
  }
  return { ok: true, value: phone };
}

// ── Uniqueness validators ─────────────────────────────────────────────
// Both reject any soft-deleted row so a user who deleted their account
// can re-register, but a live account always blocks reuse.

async function ensureEmailUnique(email, { excludeUserId = null } = {}) {
  if (!email) return { ok: true };
  const params = [email];
  let sql =
    `SELECT id FROM users
      WHERE LOWER(email) = $1
        AND COALESCE(is_deleted, FALSE) = FALSE`;
  if (excludeUserId) {
    params.push(excludeUserId);
    sql += ` AND id <> $2`;
  }
  sql += ` LIMIT 1`;
  const r = await pool.query(sql, params);
  if (r.rows.length > 0) {
    return {
      ok: false, status: 409,
      body: {
        code:    'EMAIL_TAKEN',
        field:   'email',
        message: 'This email is already registered. Please use a different email or sign in.',
      },
    };
  }
  return { ok: true };
}

async function ensurePhoneUnique(phone, { excludeUserId = null } = {}) {
  if (!phone) return { ok: true };
  const params = [phone];
  let sql =
    `SELECT id FROM users
      WHERE phone = $1
        AND COALESCE(is_deleted, FALSE) = FALSE`;
  if (excludeUserId) {
    params.push(excludeUserId);
    sql += ` AND id <> $2`;
  }
  sql += ` LIMIT 1`;
  const r = await pool.query(sql, params);
  if (r.rows.length > 0) {
    return {
      ok: false, status: 409,
      body: {
        code:    'PHONE_TAKEN',
        field:   'phone',
        message: 'This phone number is already registered to another user.',
      },
    };
  }
  return { ok: true };
}

// ── One-shot validator covering all four checks ───────────────────────
// Usage inside a controller:
//   const result = await validateContact(req.body, { emailRequired: true });
//   if (!result.ok) return res.status(result.status).json(result.body);
//   const { email, phone } = result.values;
//
// Pass excludeUserId on edits so the user can keep their own email/phone.
async function validateContact(body, opts = {}) {
  const {
    emailRequired = true,
    phoneRequired = false,
    excludeUserId = null,
    emailField    = 'email',
    phoneField    = 'phone',
  } = opts;

  // 1. Format
  const e = validateEmailFormat(body?.[emailField], { required: emailRequired });
  if (!e.ok) return e;
  const p = validatePhoneFormat(body?.[phoneField], { required: phoneRequired });
  if (!p.ok) return p;

  // 2. Uniqueness
  const eu = await ensureEmailUnique(e.value, { excludeUserId });
  if (!eu.ok) return eu;
  const pu = await ensurePhoneUnique(p.value, { excludeUserId });
  if (!pu.ok) return pu;

  return { ok: true, values: { email: e.value, phone: p.value } };
}

module.exports = {
  normaliseEmail,
  normalisePhone,
  validateEmailFormat,
  validatePhoneFormat,
  ensureEmailUnique,
  ensurePhoneUnique,
  validateContact,
};
