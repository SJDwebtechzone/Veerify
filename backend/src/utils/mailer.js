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

function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_USER || !SMTP_PASS) {
    // Don't crash on import — let approval still happen, just skip the email.
    console.warn('[mailer] SMTP_USER/SMTP_PASS not set. Emails will be skipped.');
    return null;
  }
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

function rupees(amountInRupeesOrString) {
  const n = parseInt(amountInRupeesOrString || '0', 10);
  return '₹' + n.toLocaleString('en-IN');
}

// ---------- Templates ----------

function approvalEmailHtml({ ownerName, institutionName, planName, planPrice, paymentUrl }) {
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
          ${planName || 'Subscription'} — ${rupees(planPrice)} / month
        </div>
      </div>

      <a href="${paymentUrl}"
         style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                font-weight:600;padding:14px 24px;border-radius:10px;font-size:15px;
                margin:8px 0 20px;">
        Pay ${rupees(planPrice)} now →
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
 * Send the "approved — please pay" email.
 * Returns { ok: true } or { ok: false, error }. Never throws.
 */
async function sendApprovalEmail({ to, ownerName, institutionName, planName, planPrice, paymentUrl }) {
  const t = getTransporter();
  if (!t) return { ok: false, error: 'SMTP not configured' };
  try {
    const info = await t.sendMail({
      from: `"${FROM_NAME}" <${SMTP_USER}>`,
      to,
      subject: `${institutionName} approved on Veerify — complete payment to go live`,
      html: approvalEmailHtml({ ownerName, institutionName, planName, planPrice, paymentUrl }),
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[mailer] sendApprovalEmail failed:', err.message);
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
    const info = await t.sendMail({
      from: `"${FROM_NAME}" <${SMTP_USER}>`,
      to,
      subject: `🎉 ${institutionName} is live on Veerify`,
      html: activationEmailHtml({ ownerName, institutionName, subscriptionEnd }),
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[mailer] sendActivationEmail failed:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  sendApprovalEmail,
  sendActivationEmail,
};
