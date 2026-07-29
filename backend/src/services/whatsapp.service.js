const axios = require("axios");
const pool = require("../config/db");
const { isWhatsAppEnabledForUser } = require("../utils/planFeatureGuard");

const token = process.env.WHATSAPP_ACCESS_TOKEN;
// Phone-number id is what the /v23.0/{id}/messages endpoint expects.
// Accept either canonical env name so an ops team that provisioned
// the token as WHATSAPP_WABA_ID (WhatsApp Business Account id, which
// is a DIFFERENT id but is often the value actually pasted into the
// dashboard) doesn't silently fail every send. We prefer
// PHONE_NUMBER_ID when both are set and log which one we picked so
// the server boot line makes the config explicit. Also honour a few
// alternative names that show up in the wild.
const phoneNumberId =
  process.env.WHATSAPP_PHONE_NUMBER_ID
  || process.env.WHATSAPP_WABA_ID
  || process.env.WA_PHONE_NUMBER_ID
  || process.env.META_WHATSAPP_PHONE_NUMBER_ID
  || null;
const phoneNumberIdSource = process.env.WHATSAPP_PHONE_NUMBER_ID
  ? 'WHATSAPP_PHONE_NUMBER_ID'
  : process.env.WHATSAPP_WABA_ID
    ? 'WHATSAPP_WABA_ID (fallback)'
    : process.env.WA_PHONE_NUMBER_ID
      ? 'WA_PHONE_NUMBER_ID (fallback)'
      : process.env.META_WHATSAPP_PHONE_NUMBER_ID
        ? 'META_WHATSAPP_PHONE_NUMBER_ID (fallback)'
        : 'NONE';

// One-shot startup summary so ops can spot a config gap immediately.
// Fires the first time this module is required — nodemon reloads
// re-fire it, which is deliberate.
console.log(
  `[whatsapp][boot] token=${token ? 'set' : 'MISSING'} `
  + `phoneNumberId=${phoneNumberId ? phoneNumberId : 'MISSING'} `
  + `source=${phoneNumberIdSource}`,
);
if (!phoneNumberId) {
  console.warn(
    '[whatsapp][boot] No phone-number id configured. Set WHATSAPP_PHONE_NUMBER_ID '
    + '(preferred) or WHATSAPP_WABA_ID in .env. Every send will short-circuit '
    + 'with `{ ok:false, error:"WhatsApp API not configured" }` until this is fixed.',
  );
}

// India-first default country code. If a phone number arrives without
// one (10 digits) we prepend 91 so the WhatsApp Cloud API accepts it.
const DEFAULT_COUNTRY_CODE = "91";

function toWaNumber(rawPhone) {
  if (!rawPhone) return null;
  const digits = String(rawPhone).replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10) return DEFAULT_COUNTRY_CODE + digits;
  // Already carries a country code (e.g. 919876543210 or 12025550143).
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

async function sendTextMessage(to, message) {
  if (!token || !phoneNumberId) {
    // Never crash the caller when WhatsApp isn't configured — the
    // spec's fallback contract (use email / in-app) is upheld by
    // the caller when this helper returns a non-ok result.
    console.warn(
      `[whatsapp] sendTextMessage skipped → reason=env-not-configured `
      + `token=${token ? 'set' : 'MISSING'} phoneNumberId=${phoneNumberId ? 'set' : 'MISSING'} `
      + `(read from ${phoneNumberIdSource})`,
    );
    return { ok: false, error: "WhatsApp API not configured" };
  }
  const waTo = toWaNumber(to);
  if (!waTo) {
    console.warn(`[whatsapp] sendTextMessage skipped → reason=invalid-phone raw="${to}"`);
    return { ok: false, error: "Invalid phone number" };
  }
  const apiUrl = `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`;
  console.log(
    `[whatsapp] POST → url=${apiUrl} `
    + `to="${waTo}" (raw="${to}") msg_len=${(message || '').length} `
    + `phoneNumberIdSource=${phoneNumberIdSource}`,
  );
  try {
    const res = await axios.post(
      apiUrl,
      {
        messaging_product: "whatsapp",
        to: waTo,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 10_000,
      },
    );
    const msgId = res.data?.messages?.[0]?.id || null;
    console.log(
      `[whatsapp] POST OK → to="${waTo}" messageId=${msgId || 'n/a'} `
      + `status=${res.status}`,
    );
    return { ok: true, messageId: msgId };
  } catch (err) {
    const metaErr = err?.response?.data?.error || {};
    console.warn(
      "[whatsapp] sendTextMessage failed:",
      metaErr.message || err?.message,
      "| code=", metaErr.code,
      "| subcode=", metaErr.error_subcode,
      "| type=", metaErr.type,
      "| trace=", metaErr.fbtrace_id,
    );
    // Surface enough diagnostic detail so ops can spot the exact
    // problem: expired token (code 190), missing permission
    // (code 200 / 10), unregistered recipient (code 131047), etc.
    return {
      ok: false,
      error: metaErr.message || err?.message,
      metaCode: metaErr.code || null,
      metaSubcode: metaErr.error_subcode || null,
    };
  }
}

/**
 * Welcome WhatsApp for freshly-registered accounts.
 *
 * Guards (spec):
 *   • Only after successful account creation → caller invokes AFTER
 *     the DB commit.
 *   • Only when the mobile number is present.
 *   • Only when the institution's active plan has
 *     whatsapp_notifications_enabled = TRUE (planFeatureGuard).
 *   • Only once per account — the users.welcome_wa_sent_at column
 *     from migration 074 is stamped on success and re-checked on
 *     every invocation.
 *
 * Fire-and-forget from the caller — this helper swallows every
 * failure and only logs so registration flows never break on a
 * WhatsApp outage.
 */
async function sendWelcomeMessage({ userId, name, phone, role }) {
  try {
    if (!userId || !phone) return { ok: false, skipped: "missing-user-or-phone" };

    // 1. One-time gate — already sent?
    const seen = await pool.query(
      `SELECT welcome_wa_sent_at FROM users WHERE id = $1`,
      [userId],
    );
    if (!seen.rows.length) return { ok: false, skipped: "user-not-found" };
    if (seen.rows[0].welcome_wa_sent_at) {
      return { ok: false, skipped: "already-sent" };
    }

    // 2. Plan gate — institution's active plan must have WhatsApp ON.
    const allowed = await isWhatsAppEnabledForUser(userId);
    if (!allowed) {
      return { ok: false, skipped: "whatsapp-disabled-on-plan" };
    }

    // 3. Compose + send.
    const firstName = String(name || "").trim().split(/\s+/)[0] || "there";
    const roleLabel = ({
      admin:       "institution admin",
      institution: "institution admin",
      trainer:     "trainer",
      student:     "student",
      parent:      "parent",
    }[String(role || "").toLowerCase()]) || "member";
    const body =
      `👋 Welcome to Veerify, ${firstName}!\n\n` +
      `Your ${roleLabel} account is ready. You can now sign in from the ` +
      `Veerify app to manage everything from one place.\n\n` +
      `Need help? Reply to this message or write to support@veerifyapp.com.`;

    const send = await sendTextMessage(phone, body);
    if (!send.ok) {
      // Non-ok result (bad phone, WhatsApp outage, unconfigured API).
      // Return without stamping so a retry can succeed later.
      return { ok: false, error: send.error || "send-failed" };
    }

    // 4. Stamp so we never dispatch a second welcome for this user.
    await pool.query(
      `UPDATE users SET welcome_wa_sent_at = NOW() WHERE id = $1`,
      [userId],
    );
    return { ok: true, messageId: send.messageId };
  } catch (err) {
    console.warn("[whatsapp] sendWelcomeMessage failed:", err?.message);
    return { ok: false, error: err?.message };
  }
}

async function sendTrainerCredentialsMessage({
  userId,
  trainerName,
  phone,
  academyName,
  otp,
}) {
  try {
    if (!userId || !phone || !otp) {
      return { ok: false, skipped: "missing-required-data" };
    }

    // Check whether WhatsApp is enabled for this institution's plan
    const allowed = await isWhatsAppEnabledForUser(userId);
    if (!allowed) {
      return { ok: false, skipped: "whatsapp-disabled-on-plan" };
    }

    const firstName =
      String(trainerName || "").trim().split(/\s+/)[0] || "Trainer";

    const body =
      `👋 Welcome to Veerify!\n\n` +
      `Hello ${firstName},\n\n` +
      `Your Trainer account has been created successfully.\n\n` +
      `Academy: ${academyName}\n` +
      `Login ID: ${phone}\n` +
      `OTP: ${otp}\n\n` +
      `Please log in using this OTP and change your password after your first login.\n\n` +
      `Thank you,\nVeerify Team`;

    return await sendTextMessage(phone, body);
  } catch (err) {
    console.warn(
      "[whatsapp] sendTrainerCredentialsMessage failed:",
      err?.message,
    );
    return { ok: false, error: err?.message };
  }
}
/**
 * Student credentials WhatsApp — sent right after an institution /
 * branch admin successfully creates the student account AND records
 * the enrolment. Spec fields:
 *
 *   • Welcome line
 *   • Student first name
 *   • Institution / branch name
 *   • Login email (login ID)
 *   • Temporary password
 *   • App download link (Android / iOS if configured)
 *   • Prompt to change the password after first login
 *
 * Plan gate is enforced BEFORE the send via isWhatsAppEnabledForUser.
 * Fire-and-forget from the caller — this helper never throws; every
 * failure surfaces as { ok:false, ...} so the caller's enrolment path
 * runs to completion.
 *
 * Duplicate-send protection lives in the CALLER (enrollment
 * controller) via enrollments.credentials_wa_sent_at (migration 079).
 * Keeping the stamp with the caller lets us key on enrolment id,
 * not user id, so a student joining a second course still gets a
 * fresh WhatsApp for that second enrolment.
 */
async function sendStudentCredentialsMessage({
  userId,
  phone,
  studentName,
  institutionName,
  email,
  password,
}) {
  try {
    if (!userId || !phone) {
      return { ok: false, skipped: "missing-required-data" };
    }

    // Check whether WhatsApp is enabled for this institution's plan
    const allowed = await isWhatsAppEnabledForUser(userId);
    if (!allowed) {
      return { ok: false, skipped: "whatsapp-disabled-on-plan" };
    }

    const firstName =
      String(studentName || "").trim().split(/\s+/)[0] || "Student";
    const academyLine = institutionName
      ? `You've been enrolled at *${institutionName}*.`
      : `You've been enrolled at your academy.`;

    // App-download URLs are optional env vars. Both are surfaced when
    // set so students on either platform find their store; if only
    // one is configured (typical during rollout) we render just that
    // one; if neither is configured the line is dropped entirely
    // rather than leaving a broken "Download: " prompt.
    const androidUrl = (process.env.APP_DOWNLOAD_URL_ANDROID || "").trim();
    const iosUrl     = (process.env.APP_DOWNLOAD_URL_IOS || "").trim();
    const downloadLines = [];
    if (androidUrl) downloadLines.push(`Android: ${androidUrl}`);
    if (iosUrl)     downloadLines.push(`iOS: ${iosUrl}`);
    const downloadBlock = downloadLines.length
      ? `📲 Download the Veerify app:\n${downloadLines.join("\n")}\n\n`
      : "";

    const message =
      `🎉 Welcome to Veerify!\n\n` +
      `Hi ${firstName},\n\n` +
      `${academyLine}\n\n` +
      `Here are your login credentials:\n` +
      `Login ID: ${email}\n` +
      `Temporary Password: ${password}\n\n` +
      downloadBlock +
      `🔐 Please change your password after your first login.\n\n` +
      `Regards,\nVeerify Team`;

    return await sendTextMessage(phone, message);
  } catch (err) {
    console.warn(
      "[whatsapp] sendStudentCredentialsMessage failed:",
      err?.message
    );
    return { ok: false, error: err?.message };
  }
}


module.exports = {
  sendTextMessage,
  sendWelcomeMessage,
  sendTrainerCredentialsMessage,
  sendStudentCredentialsMessage,
  toWaNumber,
};