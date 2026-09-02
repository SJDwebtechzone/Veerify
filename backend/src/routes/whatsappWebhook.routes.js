// src/routes/whatsappWebhook.routes.js
//
// WhatsApp Cloud API webhook — verification (GET) + event delivery
// (POST). Mounted under /api in server.js, so the effective URLs
// are:
//
//   GET  /api/whatsapp/webhook   ← canonical (Meta config URL)
//   POST /api/whatsapp/webhook
//   GET  /api/webhooks/whatsapp  ← legacy alias, kept so existing
//   POST /api/webhooks/whatsapp    Meta configs / cURL scripts
//                                  don't break.
//
// The handlers themselves live in module-scope functions so the
// two path variants share one implementation — there is no
// duplicated logic, only two `router.get / router.post` mounts
// pointing at the same function.
//
// Environment variables (either name is accepted; the newer
// `WHATSAPP_VERIFY_TOKEN` takes precedence when both are set):
//
//   WHATSAPP_VERIFY_TOKEN          — Meta "Verify Token" field.
//   WHATSAPP_WEBHOOK_VERIFY_TOKEN  — legacy name, still honoured.
//   WHATSAPP_APP_SECRET            — Meta App Secret used to
//                                    verify inbound POST signatures
//                                    via X-Hub-Signature-256.

const express = require('express');
const crypto  = require('crypto');

const router = express.Router();

// Read the verify token from the environment, preferring the newer
// name but falling back to the legacy one so pre-existing .env
// files continue to work without a rename.
function readVerifyToken() {
  return process.env.WHATSAPP_VERIFY_TOKEN
    || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    || '';
}

// GET handler — Meta hits this once at Configure Webhooks time.
// Echoes back the challenge string ONLY when hub.mode === 'subscribe'
// AND hub.verify_token matches the configured token. Everything
// else 403s (including a missing / empty configured token so an
// unconfigured server can never accidentally verify).
function handleVerify(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expected = readVerifyToken();
  if (
    mode === 'subscribe'
    && expected
    && typeof token === 'string'
    && token === expected
  ) {
    // Meta expects the exact challenge back as plain text with a
    // 200. `res.send` on a string handles the Content-Type + body
    // correctly.
    return res.status(200).send(String(challenge ?? ''));
  }

  // Never leak the mismatch reason; a bare 403 is what Meta expects.
  return res.sendStatus(403);
}

// POST handler — inbound webhook events from Meta. Verifies the
// HMAC signature against WHATSAPP_APP_SECRET before doing anything
// else. Logs the payload for now; downstream consumers can wire
// message-handling on top.
function handleEvent(req, res) {
  try {
    const signature = req.headers['x-hub-signature-256'];
    if (!signature || !process.env.WHATSAPP_APP_SECRET) {
      return res.sendStatus(403);
    }
    const expected =
      'sha256=' +
      crypto
        .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
        .update(req.rawBody)
        .digest('hex');
    // timingSafeEqual requires equal-length buffers; pad both to
    // the same length to avoid an unrelated crash on a malformed
    // header.
    const sigBuf = Buffer.from(String(signature));
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length
      || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.sendStatus(403);
    }

    // Downstream: parse the payload here. Log kept intentionally
    // terse so the actual secret / phone numbers aren't dumped to
    // long-lived logs.
    console.log('[WhatsApp Webhook] event received');
    return res.sendStatus(200);
  } catch (err) {
    console.error('[WhatsApp Webhook] error:', err?.message);
    return res.sendStatus(500);
  }
}

// Canonical path Meta's Configure Webhooks uses.
router.get('/whatsapp/webhook',  handleVerify);
router.post('/whatsapp/webhook', handleEvent);

// Legacy alias — kept so any older Meta config or internal test
// scripts pointing at /api/webhooks/whatsapp continue to work.
router.get('/webhooks/whatsapp',  handleVerify);
router.post('/webhooks/whatsapp', handleEvent);

module.exports = router;
