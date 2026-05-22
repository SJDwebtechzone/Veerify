// backend/src/routes/payments.routes.js
//
// Payment-related webhooks. Currently just Razorpay's payment_link.paid event.
//
// The webhook handler verifies the HMAC signature against the raw request body,
// so we depend on server.js capturing the raw bytes on req.rawBody via the
// express.json({ verify: ... }) option.

const express = require('express');
const router = express.Router();
const onboardingController = require('../controllers/onboarding.controller');

// PUBLIC — Razorpay calls this. No JWT. Signature is verified inside the handler.
router.post('/webhook', onboardingController.handlePaymentWebhook);

module.exports = router;
