// backend/scripts/test-smtp.js
//
// Quick smoke test for Gmail SMTP credentials.
// Usage:
//   node scripts/test-smtp.js                       # just verifies the login
//   node scripts/test-smtp.js you@example.com       # also sends a test email
//
// Reads SMTP_USER, SMTP_PASS, MAIL_FROM_NAME from backend/.env.

require('dotenv').config();
const nodemailer = require('nodemailer');

const { SMTP_USER, SMTP_PASS, MAIL_FROM_NAME = 'Veerify' } = process.env;

if (!SMTP_USER || !SMTP_PASS) {
  console.error('❌ SMTP_USER or SMTP_PASS missing in .env');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

(async () => {
  console.log(`▶ Verifying credentials for ${SMTP_USER}…`);
  try {
    await transporter.verify();
    console.log('✅ SMTP login OK');
  } catch (err) {
    console.error('❌ SMTP login failed:', err.message);
    process.exit(1);
  }

  const to = process.argv[2];
  if (!to) {
    console.log('(skip send — pass an email address as the first arg to send a test message)');
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"${MAIL_FROM_NAME}" <${SMTP_USER}>`,
      to,
      subject: 'Veerify SMTP test',
      text: 'If you can read this, Gmail SMTP is wired up correctly.',
    });
    console.log(`✅ Test email sent to ${to} (id=${info.messageId})`);
  } catch (err) {
    console.error('❌ Send failed:', err.message);
    process.exit(1);
  }
})();
