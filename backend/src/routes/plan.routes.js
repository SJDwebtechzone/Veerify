const express = require('express');
const router = express.Router();
const planController = require('../controllers/plan.controller');

router.get('/', planController.getPlans);
router.get('/:id', planController.getPlanById);

module.exports = router;