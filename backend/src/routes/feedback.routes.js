// backend/src/routes/feedback.routes.js
//
// Mobile-side submit endpoint + super-admin read endpoints for the
// Feedback module.

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/feedback.controller');

// Mobile submit — every role allowed EXCEPT super_admin (the resolveRoleSnapshot
// helper returns null for super_admin and the controller 403s).
router.post('/',        verifyToken, ctrl.submit);

// Super-admin read endpoints. verifyToken is enough — the controller
// itself doesn't restrict by role because the admin web is the only
// caller of these paths. A follow-up requireRole('super_admin') is
// safe to add if the app grows other consumers.
router.get('/summary',  verifyToken, ctrl.summary);
router.get('/:id',      verifyToken, ctrl.get);
router.get('/',         verifyToken, ctrl.list);

module.exports = router;
