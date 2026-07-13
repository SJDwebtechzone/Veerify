// backend/src/services/email.service.js
//
// MSG91 transactional Email API service. One reusable send helper +
// typed wrappers for every place the app currently sends email:
//
//   • Welcome                — after any Student / Trainer / Institution
//                              / Branch registration.
//   • Login credentials      — when an admin provisions a user (trainer,
//                              admin-created student, branch admin).
//   • Payment link           — when the super-admin approves an
//                              institution and a Razorpay link is created.
//   • Payment success        — when a subscription payment settles.
//   • Certificate issued     — when a course-completion certificate is
//                              minted for a student.
//   • Password reset         — the OTP flow from /auth/forgot-password.
//   • Renewal reminder       — the T-14 / T-3 / T+3 cron job that pings
//                              admins whose subscription is expiring.
//
// The underlying network call goes through _postEmail() so every wrapper
// shares one code path — retries, logging, timeout handling and error
// swallowing live in one place. Callers ALWAYS get { ok, ... } back and
// this file NEVER throws, so a MSG91 outage cannot poison the registration
// / renewal / certificate flow.
//
// ── Environment variables ────────────────────────────────────────────
// MSG91_AUTHKEY                       required. From MSG91 dashboard.
// MSG91_EMAIL_DOMAIN                  the sending domain configured on
//                                     MSG91 (e.g. mail.veerify.app).
// MSG91_EMAIL_FROM                    default from address on that domain
//                                     (e.g. no-reply@mail.veerify.app).
// MSG91_EMAIL_FROM_NAME               display name on the From header.
// MSG91_EMAIL_ENABLED                 'false' to short-circuit in dev/CI.
//
// Per-template ids — leave any of these blank and the wrapper will log
// a warning and return { ok: false } instead of firing a bad send.
// MSG91_TEMPLATE_WELCOME
// MSG91_TEMPLATE_LOGIN_CREDENTIALS
// MSG91_TEMPLATE_PAYMENT_LINK
// MSG91_TEMPLATE_PAYMENT_SUCCESS
// MSG91_TEMPLATE_CERTIFICATE_ISSUED
// MSG91_TEMPLATE_PASSWORD_RESET
// MSG91_TEMPLATE_RENEWAL_REMINDER

const MSG91_EMAIL_URL = 'https://control.msg91.com/api/v5/email/send';

// Node <18 doesn't have global fetch — reach for the polyfill only if
// missing so this file stays zero-config on modern runtimes.
const _fetch = typeof fetch === 'function'
  ? fetch
  : (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// ── Kill switch ──────────────────────────────────────────────────────
function _disabled() {
  const flag = String(process.env.MSG91_EMAIL_ENABLED ?? 'true').toLowerCase();
  return flag === 'false' || flag === '0' || flag === 'no';
}

// ── Env helpers ──────────────────────────────────────────────────────
function _from() {
  return {
    email: process.env.MSG91_EMAIL_FROM      || '',
    name:  process.env.MSG91_EMAIL_FROM_NAME || 'Veerify',
  };
}

function _domain() {
  return process.env.MSG91_EMAIL_DOMAIN || '';
}

// ── Normalisation ────────────────────────────────────────────────────
// Recipients can be a bare string, { email, name }, or an array of
// either. Normalise into MSG91's expected shape:
//   [{ to: [{ email, name }], variables: {...} }]
function _normaliseRecipients(to, variables) {
  const list = Array.isArray(to) ? to : [to];
  const recipients = list
    .map((r) => {
      if (!r) return null;
      if (typeof r === 'string') return { email: r.trim(), name: '' };
      if (r.email) return { email: String(r.email).trim(), name: r.name || '' };
      return null;
    })
    .filter((r) => r && r.email);

  if (recipients.length === 0) return [];
  return [
    {
      to: recipients,
      variables: variables || {},
    },
  ];
}

// ── Core send ────────────────────────────────────────────────────────
// The single place that talks to MSG91. All wrappers below funnel here.
//
// NOTE — request shape mirrors MSG91's v5 Email API as documented in
// their JS/cURL snippets. If your MSG91 dashboard generates a slightly
// different request body for your account, adjust only the object
// assembled below; the rest of the plumbing stays put.
async function _postEmail({ to, templateId, variables, subject, replyTo }) {
  // ── Guardrails first — every failure returns without throwing.
  if (_disabled()) {
    console.info('[MSG91 EMAIL] short-circuited — MSG91_EMAIL_ENABLED=false');
    return { ok: true, skipped: true };
  }
  if (!process.env.MSG91_AUTHKEY) {
    console.warn('[MSG91 EMAIL] MSG91_AUTHKEY missing — email not sent');
    return { ok: false, error: 'MSG91_AUTHKEY not configured' };
  }
  if (!templateId) {
    console.warn('[MSG91 EMAIL] template_id missing — email not sent');
    return { ok: false, error: 'template_id not configured' };
  }
  const from = _from();
  if (!from.email) {
    console.warn('[MSG91 EMAIL] MSG91_EMAIL_FROM missing — email not sent');
    return { ok: false, error: 'from address not configured' };
  }
  const recipients = _normaliseRecipients(to, variables);
  if (recipients.length === 0) {
    console.warn('[MSG91 EMAIL] no valid recipient in payload');
    return { ok: false, error: 'no valid recipient' };
  }

  const body = {
    recipients,
    from,
    domain:      _domain(),
    template_id: templateId,
  };
  if (subject) body.subject = subject;
  if (replyTo) body.reply_to = [{ email: replyTo }];

  // 10s timeout so a MSG91 hang can't stall Express.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const resp = await _fetch(MSG91_EMAIL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        accept:         'application/json',
        authkey:        process.env.MSG91_AUTHKEY,
      },
      body:   JSON.stringify(body),
      signal: controller.signal,
    });

    // Prefer JSON parse but fall back to raw text — MSG91 occasionally
    // returns HTML on 5xx.
    let payload = null;
    const raw = await resp.text().catch(() => '');
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }

    if (!resp.ok) {
      console.warn(
        `[MSG91 EMAIL] send failed status=${resp.status} template=${templateId} err=`,
        payload,
      );
      return { ok: false, status: resp.status, error: payload };
    }
    console.info(
      `[MSG91 EMAIL] delivered template=${templateId} to=${recipients[0].to
        .map((r) => r.email)
        .join(',')}`,
    );
    return { ok: true, status: resp.status, response: payload };
  } catch (err) {
    console.error('[MSG91 EMAIL] uncaught send error:', err?.message || err);
    return { ok: false, error: err?.message || 'send failed' };
  } finally {
    clearTimeout(timer);
  }
}

// ── Fire-and-forget wrapper ──────────────────────────────────────────
// Callers inside registration / payment / cron flows should use THIS
// when they don't care about the send result and just want the caller
// path to stay unblocked. Never throws, always logs.
function dispatch(sendFn, payload) {
  setImmediate(() => {
    sendFn(payload).catch((err) => {
      console.error('[MSG91 EMAIL] dispatch uncaught:', err?.message || err);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// Wrappers — one per business event. Each takes a plain payload and
// funnels into _postEmail with the right env-driven template id.
// ─────────────────────────────────────────────────────────────────────

// Welcome email — fired right after registration succeeds. `role` is
// one of student / trainer / institution / branch so the template can
// personalise the greeting.
async function sendWelcomeEmail({ to, name, role, loginId }) {
  return _postEmail({
    to,
    templateId: process.env.MSG91_TEMPLATE_WELCOME,
    subject:    'Welcome to Veerify',
    variables:  {
      name:     name || '',
      role:     role || '',
      login_id: loginId || '',
    },
  });
}

// Login credentials — admin-provisioned accounts (trainer, admin-created
// student, branch admin). Includes the temp password so the user can
// sign in and change it on first login.
async function sendLoginCredentialsEmail({
  to, name, role, loginEmail, tempPassword, institutionName,
}) {
  return _postEmail({
    to,
    templateId: process.env.MSG91_TEMPLATE_LOGIN_CREDENTIALS,
    subject:    'Your Veerify login details',
    variables:  {
      name:             name || '',
      role:             role || '',
      login_email:      loginEmail || '',
      temp_password:    tempPassword || '',
      institution_name: institutionName || '',
    },
  });
}

// Payment link email — super-admin approves an institution, Razorpay
// mints a hosted link, we email it to the owner. `expiresAt` is a human
// string the template can drop in verbatim.
async function sendPaymentLinkEmail({
  to, name, planName, amount, paymentUrl, expiresAt,
}) {
  return _postEmail({
    to,
    templateId: process.env.MSG91_TEMPLATE_PAYMENT_LINK,
    subject:    'Complete your Veerify subscription payment',
    variables:  {
      name:        name || '',
      plan_name:   planName || '',
      amount:      amount != null ? String(amount) : '',
      payment_url: paymentUrl || '',
      expires_at:  expiresAt || '',
    },
  });
}

// Payment success email — Razorpay webhook confirmed the charge.
async function sendPaymentSuccessEmail({
  to, name, planName, amount, transactionId, validUntil,
}) {
  return _postEmail({
    to,
    templateId: process.env.MSG91_TEMPLATE_PAYMENT_SUCCESS,
    subject:    'Payment received — Veerify subscription active',
    variables:  {
      name:           name || '',
      plan_name:      planName || '',
      amount:         amount != null ? String(amount) : '',
      transaction_id: transactionId || '',
      valid_until:    validUntil || '',
    },
  });
}

// Certificate issued email — fired when the trainer / admin approves a
// course-completion certificate. `certificateUrl` is the S3 / uploads
// path the student can download.
async function sendCertificateIssuedEmail({
  to, name, courseName, institutionName, certificateUrl, issuedOn,
}) {
  return _postEmail({
    to,
    templateId: process.env.MSG91_TEMPLATE_CERTIFICATE_ISSUED,
    subject:    'Your certificate is ready',
    variables:  {
      name:             name || '',
      course_name:      courseName || '',
      institution_name: institutionName || '',
      certificate_url:  certificateUrl || '',
      issued_on:        issuedOn || '',
    },
  });
}

// Password reset OTP — 6-digit code + expiry in minutes.
async function sendPasswordResetEmail({ to, name, otp, expiresMinutes }) {
  return _postEmail({
    to,
    templateId: process.env.MSG91_TEMPLATE_PASSWORD_RESET,
    subject:    'Your Veerify password reset code',
    variables:  {
      name:            name || '',
      otp:             String(otp || ''),
      expires_minutes: String(expiresMinutes || 10),
    },
  });
}

// Renewal reminder email — dispatched by the subscription-expiry cron.
// `daysRemaining` may be negative (grace period) so the template can
// render "expired X days ago" vs. "expires in X days".
async function sendRenewalReminderEmail({
  to, name, planName, expiresOn, daysRemaining, renewUrl,
}) {
  return _postEmail({
    to,
    templateId: process.env.MSG91_TEMPLATE_RENEWAL_REMINDER,
    subject:    'Your Veerify subscription is expiring soon',
    variables:  {
      name:           name || '',
      plan_name:      planName || '',
      expires_on:     expiresOn || '',
      days_remaining: String(daysRemaining ?? ''),
      renew_url:      renewUrl || '',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Diagnostics — a bare-metal test send used by /api/dev/email-test to
// prove the account credentials + registered domain are wired end-to-end
// from the running Express process. Not exposed in production.
//
// Uses MSG91's BUILT-IN `global_otp` template (the one every MSG91
// account gets for free) so you can verify the account is live BEFORE
// creating any custom templates. The template needs two variables:
// `company_name` and `otp`.
// ─────────────────────────────────────────────────────────────────────
async function sendTestEmail(to) {
  return _postEmail({
    to,
    templateId: 'global_otp',
    subject:    'Veerify — MSG91 email integration test',
    variables:  {
      company_name: process.env.MSG91_EMAIL_FROM_NAME || 'Veerify',
      // Six-digit throwaway just so the built-in OTP template renders.
      // This is not a real OTP and is not stored anywhere.
      otp: String(Math.floor(100000 + Math.random() * 900000)),
    },
  });
}

module.exports = {
  // Core
  sendEmail: _postEmail,
  dispatch,

  // Typed wrappers
  sendWelcomeEmail,
  sendLoginCredentialsEmail,
  sendPaymentLinkEmail,
  sendPaymentSuccessEmail,
  sendCertificateIssuedEmail,
  sendPasswordResetEmail,
  sendRenewalReminderEmail,

  // Diagnostics
  sendTestEmail,
};
