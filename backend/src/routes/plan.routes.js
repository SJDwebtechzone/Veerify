const express = require('express');
const router = express.Router();
const planController = require('../controllers/plan.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Public reads — institution admins fetch active plans during onboarding.
router.get('/',    planController.getPlans);
// Institution-admin's current usage vs caps (must be above /:id so the
// param matcher doesn't shadow it).
router.get('/usage', verifyToken, requireRole('admin'), planController.getUsage);
router.get('/:id', planController.getPlanById);

// Super-admin writes. Intentionally unauthenticated for now (matches the rest
// of the admin CRUD); lock down with verifyToken + requireRole once admin auth
// is wired in across the board.
router.post('/',     planController.createPlan);
router.put('/:id',   planController.updatePlan);
router.delete('/:id', planController.deletePlan);

module.exports = router;
