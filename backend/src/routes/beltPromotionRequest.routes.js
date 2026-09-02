// backend/src/routes/beltPromotionRequest.routes.js
//
// Mounted at /api/belt-promotion-requests. Every route requires a
// valid JWT; role gates live inside each controller so a
// misconfigured role never sneaks past a middleware-only check.

const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../utils/subscriptionGuard');
const ctrl = require('../controllers/beltPromotionRequest.controller');

// Trainer submits a new promotion request. Subscription-gated so an
// expired institution can't accumulate a queue of unfulfillable
// requests.
router.post('/',              verifyToken, requireRole('trainer'), requireActiveSubscription, ctrl.create);
router.get ('/mine',          verifyToken, requireRole('trainer'), ctrl.listMine);
// Student-facing companion — powers the "Promoted" badge on the
// student's EnrolledCourse curriculum view. Read-only, student role.
router.get ('/mine-as-student', verifyToken, requireRole('student'), ctrl.listMineAsStudent);
router.get ('/institution',   verifyToken, requireRole('admin'),   ctrl.listInstitution);

// Admin decisions. Both go through requireActiveSubscription so a
// lapsed academy can't approve certificates.
router.post('/:id/notify-trainer', verifyToken, requireRole('admin'), requireActiveSubscription, ctrl.notifyTrainer);
router.post('/:id/approve',        verifyToken, requireRole('admin'), requireActiveSubscription, ctrl.approve);

module.exports = router;
