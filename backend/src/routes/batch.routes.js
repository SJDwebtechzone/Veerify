const express = require('express');
const router = express.Router();
const batchController = require('../controllers/batch.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../utils/subscriptionGuard');

// Trainer's own batches (must come BEFORE /:id route)
router.get('/trainer/my', verifyToken, requireRole('trainer'), batchController.getMyTrainerBatches);

// Public routes
router.get('/course/:id', batchController.getBatchesByCourse);
router.get('/:id', batchController.getBatchById);

// Admin-only routes. Every write path is gated by requireActiveSubscription.
router.post('/', verifyToken, requireRole('admin'), requireActiveSubscription, batchController.createBatch);
router.get('/', verifyToken, requireRole('admin'), batchController.getMyBatches);
router.put('/:id', verifyToken, requireRole('admin'), requireActiveSubscription, batchController.updateBatch);
router.delete('/:id', verifyToken, requireRole('admin'), requireActiveSubscription, batchController.deleteBatch);

module.exports = router;