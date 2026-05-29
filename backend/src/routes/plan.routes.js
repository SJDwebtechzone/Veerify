const express = require('express');
const router = express.Router();
const planController = require('../controllers/plan.controller');

// Public reads — institution admins fetch active plans during onboarding.
router.get('/',    planController.getPlans);
router.get('/:id', planController.getPlanById);

// Super-admin writes. Intentionally unauthenticated for now (matches the rest
// of the admin CRUD); lock down with verifyToken + requireRole once admin auth
// is wired in across the board.
router.post('/',     planController.createPlan);
router.put('/:id',   planController.updatePlan);
router.delete('/:id', planController.deletePlan);

module.exports = router;
