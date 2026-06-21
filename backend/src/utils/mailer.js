// backend/src/utils/mailer.js
//
// Email helper for transactional admin emails (approval notice with payment
// link, "you're live" confirmation). Uses Nodemailer over Gmail SMTP with an
// app password.
//
// Required env vars (see backend/SETUP_PAYMENTS.md):
//   SMTP_USER           Your Gmail address, e.g. connectwithdevspectra@gmail.com
//   SMTP_PASS           A Gmail App Password (NOT your normal password)
//   MAIL_FROM_NAME      Display name on the From header, e.g. "Veerify Admin"
//   SUPPORT_EMAIL       Optional. Shown in email footers. Defaults to SMTP_USER.

const nodemailer = require('nodemailer');

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_NAME = process.env.MAIL_FROM_NAME || 'Veerify';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || SMTP_USER;

let transporter = null;
let verifyPromise = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_USER || !SMTP_PASS) {
    // Don't crash on import — let approval still happen, just skip the email.
    console.warn('[mailer] SMTP_USER/SMTP_PASS not set. Emails will be skipped.');
    return null;
  }
  transporter = nodemailer.createTransport({
    // Use the explicit host/port + TLS combo. Gmail's `service: 'gmail'`
    // shortcut still works, but spelling it out lets us pin keepalive +
    // pool which Gmail likes — fewer "throttled" errors after the first
    // few sends in a session.
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  // Verify once on first use and log the result. Catches "Invalid auth"
  // (wrong app password) and "535 5.7.8" (2FA not on, normal password
  // used instead of app password) immediately instead of failing
  // silently per-send.
  verifyPromise = transporter.verify().then(
    () => {
      console.log('[mailer] SMTP connection verified OK for', SMTP_USER);
      return true;
    },
    (err) => {
      console.error('[mailer] SMTP verify FAILED:', err.message);
      console.error('[mailer]   → Check SMTP_USER / SMTP_PASS in backend/.env');
      console.error('[mailer]   → SMTP_PASS must be a Gmail APP PASSWORD, not your normal Google password');
      console.error('[mailer]   → 2FA must be enabled on the Google account to generate one');
      return false;
    },
  );
  return transporter;
}

// Optional helper a caller can await before booting if it wants to fail
// fast on bad SMTP creds. Most callers don't bother and rely on the
// per-send error log.
function verifyTransporter() {
  getTransporter();
  return verifyPromise || Promise.resolve(false);
}

// Strip HTML to a sensible plain-text fallback. Having BOTH the html
// and text parts on every message lowers the spam score — Gmail and
// Outlook penalise html-only messages.
function toPlainText(html) {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+\n/g, '\n')
    .trim();
}

// Standard headers we want on every transactional send. Reply-To +
// X-Mailer + X-Priority lower the spam score; Auto-Submitted tells
// recipient servers this is a triggered (not bulk-marketing) message.
function transactionalHeaders() {
  return {
    'X-Mailer':         'Veerify Mailer',
    'X-Priority':       '3',
    'X-MSMail-Priority': 'Normal',
    'Importance':       'Normal',
    'Auto-Submitted':   'auto-generated',
  };
}

function rupees(amountInRupeesOrString) {
  const n = parseInt(amountInRupeesOrString || '0', 10);
  return '₹' + n.toLocaleString('en-IN');
}

// ---------- Templates ----------

function approvalEmailHtml({
  ownerName, institutionName, planName, planPrice, paymentUrl,
  trialDays = 0, graceDays = 0, effectivePrice = null,
  discountEnabled = false, discountPercent = 0,
}) {
  const hasTrial = Number(trialDays) > 0;
  const chargedAmount = effectivePrice != null ? effectivePrice : planPrice;
  const discountLine = discountEnabled && discountPercent > 0
    ? `<div style="font-size:12px;color:#16a34a;margin-top:4px;">
         ${discountPercent}% discount applied — was ${rupees(planPrice)}
       </div>`
    : '';

  // Trial path: lead with "your free trial starts now", keep the payment link
  // tucked at the bottom as "save for later". No "Pay now" CTA, since the
  // whole point of the trial is that they don't pay yet.
  if (hasTrial) {
    return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                max-width:560px;margin:0 auto;padding:24px;color:#0f172a;background:#f8fafc;">
      <div style="background:#fff;border-radius:14px;padding:32px;border:1px solid #e2e8f0;">
        <div style="display:inline-block;background:#16a34a;color:#fff;font-weight:600;
                    font-size:12px;padding:6px 12px;border-radius:999px;letter-spacing:.5px;">
          ✓ APPROVED — FREE TRIAL ACTIVE
        </div>
        <h1 style="font-size:22px;margin:18px 0 8px;">Hi ${ownerName || 'there'},</h1>
        <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 16px;">
          Good news — <b>${institutionName}</b> has been approved on Veerify, and your
          <b>${trialDays}-day free trial</b> starts right now. You have full access to
          every feature on the ${planName || 'Subscription'} plan.
        </p>

        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;
                    padding:16px;margin:18px 0;">
          <div style="font-size:13px;color:#065f46;line-height:1.6;">
            <b>No payment required during the trial.</b><br/>
            Open the Veerify mobile app, sign in with your registered email, and you'll
            land directly in your academy dashboard.
          </div>
        </div>

        <div style="background:#f1f5f9;border-radius:10px;padding:16px;margin:20px 0;">
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">
            What happens after ${trialDays} days
          </div>
          <div style="font-size:14px;color:#334155;margin-top:6px;line-height:1.6;">
            You'll have <b>${graceDays} day${graceDays === 1 ? '' : 's'}</b> to pay
            <b>${rupees(chargedAmount)}</b> to keep your academy active. We'll send
            you a reminder before then.
            ${discountLine}
          </div>
        </div>

        <p style="font-size:13px;color:#64748b;margin:24px 0 6px;">
          Want to pay early? You can use this link anytime:
        </p>
        <p style="font-size:13px;word-break:break-all;margin:0 0 24px;">
          <a href="${paymentUrl}" style="color:#2563eb;">${paymentUrl}</a>
        </p>

        <p style="font-size:12px;color:#94a3b8;margin:24px 0 0;">
          Questions? Reply to this email or write to
          <a href="mailto:${SUPPORT_EMAIL}" style="color:#64748b;">${SUPPORT_EMAIL}</a>.
        </p>
      </div>
      <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:16px;">
        Veerify — the command center for martial arts academies.
      </p>
    </div>`;
  }

  // Legacy / no-trial path: original "approved — please pay" email.
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
              max-width:560px;margin:0 auto;padding:24px;color:#0f172a;
              background:#f8fafc;">
    <div style="background:#fff;border-radius:14px;padding:32px;border:1px solid #e2e8f0;">
      <div style="display:inline-block;background:#16a34a;color:#fff;font-weight:600;
                  font-size:12px;padding:6px 12px;border-radius:999px;letter-spacing:.5px;">
        ✓ APPROVED
      </div>
      <h1 style="font-size:22px;margin:18px 0 8px;">Hi ${ownerName || 'there'},</h1>
      <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 16px;">
        Good news — your academy <b>${institutionName}</b> has been approved on Veerify.
        One last step before you go live: complete the subscription payment.
      </p>

      <div style="background:#f1f5f9;border-radius:10px;padding:16px;margin:20px 0;">
        <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">
          Plan
        </div>
        <div style="font-size:18px;font-weight:600;margin-top:4px;">
          ${planName || 'Subscription'} — ${rupees(chargedAmount)} / month
        </div>
        ${discountLine}
      </div>

      <a href="${paymentUrl}"
         style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                font-weight:600;padding:14px 24px;border-radius:10px;font-size:15px;
                margin:8px 0 20px;">
        Pay ${rupees(chargedAmount)} now →
      </a>

      <p style="font-size:13px;color:#64748b;margin:0 0 6px;">
        If the button doesn't work, copy and paste this link into your browser:
      </p>
      <p style="font-size:13px;word-break:break-all;margin:0 0 24px;">
        <a href="${paymentUrl}" style="color:#2563eb;">${paymentUrl}</a>
      </p>

      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />

      <p style="font-size:13px;color:#64748b;line-height:1.6;margin:0;">
        <b>What happens after you pay?</b><br/>
        Your academy goes live instantly. Open the Veerify mobile app and sign in
        with your registered email — you'll land in your institution dashboard.
      </p>

      <p style="font-size:12px;color:#94a3b8;margin:24px 0 0;">
        Questions? Reply to this email or write to
        <a href="mailto:${SUPPORT_EMAIL}" style="color:#64748b;">${SUPPORT_EMAIL}</a>.
      </p>
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:16px;">
      Veerify — the command center for martial arts academies.
    </p>
  </div>`;
}

function activationEmailHtml({ ownerName, institutionName, subscriptionEnd }) {
  const expires = subscriptionEnd
    ? new Date(subscriptionEnd).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
              max-width:560px;margin:0 auto;padding:24px;color:#0f172a;background:#f8fafc;">
    <div style="background:#fff;border-radius:14px;padding:32px;border:1px solid #e2e8f0;">
      <div style="font-size:40px;line-height:1;">🎉</div>
      <h1 style="font-size:22px;margin:12px 0 8px;">You're live, ${ownerName || 'there'}!</h1>
      <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 16px;">
        Payment received. <b>${institutionName}</b> is now active on Veerify.
      </p>

      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;
                  padding:16px;margin:18px 0;">
        <div style="font-size:13px;color:#065f46;">
          Open the <b>Veerify mobile app</b> and sign in with your registered email.
          You'll land directly in your institution dashboard where you can add
          batches, students, trainers, and start tracking attendance.
        </div>
      </div>

      ${expires ? `
      <p style="font-size:13px;color:#64748b;margin:0 0 6px;">
        Your subscription is active until <b>${expires}</b>.
        We'll remind you a week before it expires.
      </p>` : ''}

      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />

      <p style="font-size:12px;color:#94a3b8;margin:0;">
        Need help? Write to
        <a href="mailto:${SUPPORT_EMAIL}" style="color:#64748b;">${SUPPORT_EMAIL}</a>.
      </p>
    </div>
  </div>`;
}

// ---------- Public API ----------

/**
 * Send the "approved" email. The body branches:
 *  - trialDays > 0 → celebratory "free trial started, no payment yet" email,
 *    payment link tucked at the bottom as an early-pay option.
 *  - trialDays = 0 → original "complete payment to go live" email.
 * Returns { ok: true } or { ok: false, error }. Never throws.
 */
async function sendApprovalEmail({
  to, ownerName, institutionName, planName, planPrice, paymentUrl,
  trialDays = 0, graceDays = 0, effectivePrice = null,
  discountEnabled = false, discountPercent = 0,
}) {
  const t = getTransporter();
  if (!t) return { ok: false, error: 'SMTP not configured' };
  try {
    const hasTrial = Number(trialDays) > 0;
    const subject = hasTrial
      ? `${institutionName} approved on Veerify — your ${trialDays}-day free trial is live`
      : `${institutionName} approved on Veerify — complete payment to go live`;
    const html = approvalEmailHtml({
      ownerName, institutionName, planName, planPrice, paymentUrl,
      trialDays, graceDays, effectivePrice, discountEnabled, discountPercent,
    });
    const info = await t.sendMail({
      from: `"${FROM_NAME}" <${SMTP_USER}>`,
      to,
      subject,
      replyTo: SUPPORT_EMAIL,
      html,
      text: toPlainText(html),
      headers: transactionalHeaders(),
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[mailer] sendApprovalEmail failed:', err.message);
    return { ok: false, error: err.message };
  }
}

// ---------- Password reset template ----------

function passwordResetEmailHtml({ name, otp, expiresMinutes }) {
  // Plain, quiet, mostly-text layout. No badges in all-caps, no red
  // alert boxes, no oversized OTP — those are the patterns Gmail
  // associates with phishing templates. We keep things looking like
  // a normal "here's a code" email from a vendor.
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
              max-width:560px;margin:0 auto;padding:24px;color:#1f2937;background:#ffffff;">
    <p style="font-size:15px;margin:0 0 16px;">Hi ${name || 'there'},</p>

    <p style="font-size:15px;line-height:1.6;color:#1f2937;margin:0 0 16px;">
      You recently asked to reset the password for your Veerify account.
      Enter the verification code below in the Veerify app to choose a new password.
    </p>

    <p style="font-size:22px;font-weight:700;color:#111827;letter-spacing:6px;
              margin:24px 0;font-family:Consolas,'SF Mono','Monaco',monospace;">
      ${otp}
    </p>

    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 16px;">
      This code expires in ${expiresMinutes} minutes.
      If you did not request a password reset, you can ignore this email — your
      password will not change.
    </p>

    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 8px;">
      Thanks,<br/>
      The Veerify team
    </p>

    <p style="font-size:12px;color:#9ca3af;margin:24px 0 0;">
      You are receiving this email because a password reset was requested for
      a Veerify account associated with this address.
    </p>
  </div>`;
}

/**
 * Send a 6-digit OTP for password reset.
 * Returns { ok, error? }. Never throws.
 */
async function sendPasswordResetEmail({ to, name, otp, expiresMinutes = 10 }) {
  const t = getTransporter();
  if (!t) return { ok: false, error: 'SMTP not configured' };
  try {
    const html = passwordResetEmailHtml({ name, otp, expiresMinutes });
    // Build a clean plain-text fallback so the message has a multipart
    // body — html-only sends are routinely spam-flagged.
    const text =
      `Hi ${name || 'there'},\n\n` +
      `We received a request to reset the password on your Veerify account.\n` +
      `Enter the code below in the Veerify app to choose a new password.\n\n` +
      `   ${otp}\n\n` +
      `This code is valid for ${expiresMinutes} minutes.\n` +
      `If you did not request this, you can safely ignore this email.\n\n` +
      `— The Veerify team\n`;

    const info = await t.sendMail({
      from: `"${FROM_NAME}" <${SMTP_USER}>`,
      to,
      // IMPORTANT: do NOT put the OTP in the subject. Gmail's spam
      // filter strongly down-ranks short codes / passwords in
      // subjects ("looks like phishing"). Keep the subject neutral
      // and put the code in the body where it belongs.
      subject: 'Reset your Veerify password',
      replyTo: SUPPORT_EMAIL,
      html,
      text,
      headers: transactionalHeaders(),
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[mailer] sendPasswordResetEmail failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Send the "you're live" email after payment is confirmed.
 * Returns { ok, error? }. Never throws.
 */
async function sendActivationEmail({ to, ownerName, institutionName, subscriptionEnd }) {
  const t = getTransporter();
  if (!t) return { ok: false, error: 'SMTP not configured' };
  try {
    const html = activationEmailHtml({ ownerName, institutionName, subscriptionEnd });
    const info = await t.sendMail({
      from: `"${FROM_NAME}" <${SMTP_USER}>`,
      to,
      subject: `${institutionName} is live on Veerify`,
      replyTo: SUPPORT_EMAIL,
      html,
      text: toPlainText(html),
      headers: transactionalHeaders(),
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[mailer] sendActivationEmail failed:', err.message);
    return { ok: false, error: err.message };
  }
}

// ---------- Trainer credentials template ----------

function trainerCredentialsEmailHtml({ name, institutionName, loginEmail, password }) {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
              max-width:560px;margin:0 auto;padding:24px;color:#0f172a;
              background:#f8fafc;">
    <div style="background:#fff;border-radius:14px;padding:32px;border:1px solid #e2e8f0;">
      <div style="display:inline-block;background:#10B981;color:#fff;font-weight:600;
                  font-size:12px;padding:6px 12px;border-radius:999px;letter-spacing:.5px;">
        WELCOME — TRAINER ACCESS
      </div>
      <h1 style="font-size:22px;margin:18px 0 8px;">Hi ${name || 'there'},</h1>
      <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 16px;">
        You've been added as a trainer at <b>${institutionName || 'your academy'}</b> on Veerify.
        Use the credentials below to sign in to the Veerify mobile app and start
        managing your batches, attendance and student progress.
      </p>

      <div style="background:#f1f5f9;border-radius:12px;padding:18px;margin:20px 0;">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;
                    letter-spacing:.8px;font-weight:700;margin-bottom:8px;">
          Your sign-in details
        </div>
        <div style="font-size:13px;color:#334155;margin-bottom:8px;">
          <b>Email:</b>
          <span style="font-family:'SF Mono','Monaco',monospace;color:#0f172a;">${loginEmail}</span>
        </div>
        <div style="font-size:13px;color:#334155;">
          <b>Password:</b>
          <span style="font-family:'SF Mono','Monaco',monospace;background:#fff;
                       border:1px solid #cbd5e1;padding:3px 8px;border-radius:6px;
                       color:#0f172a;letter-spacing:1px;">${password}</span>
        </div>
      </div>

      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;
                  padding:14px;margin:20px 0;">
        <div style="font-size:13px;color:#78350f;line-height:1.6;">
          <b>Tip:</b> Change your password after your first login from the
          Profile screen for safety.
        </div>
      </div>

      <p style="font-size:13px;color:#64748b;line-height:1.6;margin:16px 0 0;">
        Open the <b>Veerify mobile app</b> and tap "Sign in" with the email and
        password above. If you don't have the app yet, install it from the
        Play Store or App Store.
      </p>

      <hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0;">
      <p style="font-size:12px;color:#94a3b8;margin:0;">
        Questions? Reply to this email or write to
        <a href="mailto:${SUPPORT_EMAIL}" style="color:#64748b;">${SUPPORT_EMAIL}</a>.
      </p>
    </div>
  </div>`;
}

/**
 * Email a newly-created trainer their login email + plaintext password so
 * they can sign in to the Veerify mobile app. Called from createTrainer.
 * Returns { ok, error? }. Never throws.
 */
async function sendTrainerCredentialsEmail({
  to, name, institutionName, loginEmail, password,
}) {
  const t = getTransporter();
  if (!t) return { ok: false, error: 'SMTP not configured' };
  try {
    const html = trainerCredentialsEmailHtml({ name, institutionName, loginEmail, password });
    const text =
      `Hi ${name || 'there'},\n\n` +
      `You've been added as a trainer at ${institutionName || 'your academy'} on Veerify.\n\n` +
      `Sign-in details for the Veerify mobile app:\n` +
      `  Email:    ${loginEmail}\n` +
      `  Password: ${password}\n\n` +
      `Open the Veerify mobile app and sign in with the details above.\n` +
      `For safety, change the password from your Profile screen after first login.\n\n` +
      `— The Veerify team\n`;
    const info = await t.sendMail({
      from: `"${FROM_NAME}" <${SMTP_USER}>`,
      to,
      subject: `Welcome to Veerify — your trainer access for ${institutionName || 'your academy'}`,
      replyTo: SUPPORT_EMAIL,
      html,
      text,
      headers: transactionalHeaders(),
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[mailer] sendTrainerCredentialsEmail failed:', err.message);
    return { ok: false, error: err.message };
  }
}

// ---------- Student credentials template ----------
// Sent when an institution admin enrols a student. The student didn't
// sign up themselves so they need to know how to log in to the Veerify
// mobile app to see their courses, attendance, and progress.

function studentCredentialsEmailHtml({ name, institutionName, courseName, loginEmail, password }) {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
              max-width:560px;margin:0 auto;padding:24px;color:#1f2937;background:#ffffff;">
    <p style="font-size:15px;margin:0 0 16px;">Hi ${name || 'there'},</p>

    <p style="font-size:15px;line-height:1.6;color:#1f2937;margin:0 0 16px;">
      ${institutionName || 'Your academy'} has enrolled you${courseName ? ` in <b>${courseName}</b>` : ''} on Veerify.
      Use the credentials below to sign in to the Veerify mobile app and start tracking your classes,
      attendance, and progress.
    </p>

    <table style="font-size:14px;line-height:1.6;color:#1f2937;margin:0 0 16px;">
      <tr>
        <td style="padding:4px 12px 4px 0;color:#4b5563;">Email:</td>
        <td style="font-family:Consolas,'SF Mono','Monaco',monospace;">${loginEmail}</td>
      </tr>
      <tr>
        <td style="padding:4px 12px 4px 0;color:#4b5563;">Password:</td>
        <td style="font-family:Consolas,'SF Mono','Monaco',monospace;">${password}</td>
      </tr>
    </table>

    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 16px;">
      For safety, please change your password from the Profile screen after your first login.
    </p>

    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 8px;">
      Thanks,<br/>
      The Veerify team
    </p>
  </div>`;
}

async function sendStudentCredentialsEmail({
  to, name, institutionName, courseName, loginEmail, password,
}) {
  const t = getTransporter();
  if (!t) return { ok: false, error: 'SMTP not configured' };
  try {
    const html = studentCredentialsEmailHtml({ name, institutionName, courseName, loginEmail, password });
    const text =
      `Hi ${name || 'there'},\n\n` +
      `${institutionName || 'Your academy'} has enrolled you on Veerify` +
      `${courseName ? ` in ${courseName}` : ''}.\n\n` +
      `Sign-in details for the Veerify mobile app:\n` +
      `  Email:    ${loginEmail}\n` +
      `  Password: ${password}\n\n` +
      `For safety, please change your password from your Profile screen after first login.\n\n` +
      `— The Veerify team\n`;
    const info = await t.sendMail({
      from: `"${FROM_NAME}" <${SMTP_USER}>`,
      to,
      subject: `Welcome to Veerify — your student access for ${institutionName || 'your academy'}`,
      replyTo: SUPPORT_EMAIL,
      html,
      text,
      headers: transactionalHeaders(),
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[mailer] sendStudentCredentialsEmail failed:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  sendApprovalEmail,
  sendActivationEmail,
  sendPasswordResetEmail,
  sendTrainerCredentialsEmail,
  sendStudentCredentialsEmail,
  verifyTransporter,
};
