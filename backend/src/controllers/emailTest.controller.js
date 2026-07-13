// backend/src/controllers/emailTest.controller.js
//
// Diagnostic controller for the MSG91 email integration.
//
// GET /api/dev/email-test?to=someone@example.com
//   Fires the "welcome" template at the supplied address and returns
//   MSG91's raw response. Handy for verifying the AUTHKEY + template id
//   + sender domain are correctly configured in .env before wiring the
//   service into the registration flow.
//
// The route is registered behind NODE_ENV !== 'production' (see
// server.js) so a leaked link can't be abused to spam once the app is
// live.

const emailService = require('../services/email.service');

exports.testSend = async (req, res) => {
  const to = String(req.query.to || '').trim();
  if (!to || !/\S+@\S+\.\S+/.test(to)) {
    return res.status(400).json({
      ok:      false,
      message: 'Query ?to=<email-address> is required',
    });
  }

  const started = Date.now();
  const result = await emailService.sendTestEmail(to);
  const ms = Date.now() - started;

  if (result.ok) {
    return res.json({
      ok:              true,
      message:         result.skipped
        ? 'Email service disabled (MSG91_EMAIL_ENABLED=false) — no-op'
        : 'Test email dispatched successfully — check the inbox.',
      duration_ms:     ms,
      msg91_response:  result.response ?? null,
    });
  }
  return res.status(502).json({
    ok:              false,
    message:         'MSG91 send failed — see server logs for details.',
    duration_ms:     ms,
    error:           result.error,
    msg91_status:    result.status ?? null,
  });
};
