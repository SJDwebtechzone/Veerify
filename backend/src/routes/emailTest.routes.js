// backend/src/routes/emailTest.routes.js
//
// Dev-only route for verifying the MSG91 email integration end-to-end.
// Mounted by server.js at /api/dev/email-test ONLY when NODE_ENV is not
// 'production', so the diagnostic endpoint can't be abused in the wild.

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/emailTest.controller');

router.get('/', ctrl.testSend);

module.exports = router;
