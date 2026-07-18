const express = require('express');
const router = express.Router();
const trainerController = require('../controllers/trainer.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../utils/subscriptionGuard');

// Trainer's own profile (must come before /:id so it's not captured as an id).
router.get('/me', verifyToken, requireRole('trainer'), trainerController.getMe);

// Super admin - platform-wide trainers roster (also a static path - must
// come before /:id).
router.get('/all', verifyToken, trainerController.getAllTrainers);

// Public — a lightweight trainer profile keyed by id. No auth so
// guests browsing Course Detail can open a trainer's public card.
// Static path :id/public must come BEFORE the admin-scoped /:id
// route so Express doesn't capture "public" as an id.
router.get('/:id/public', trainerController.getPublicTrainerById);

// All other trainer routes are admin-only
router.post('/', verifyToken, requireRole('admin'), requireActiveSubscription, trainerController.createTrainer);
router.get('/', verifyToken, requireRole('admin'), trainerController.getMyTrainers);
router.get('/:id', verifyToken, requireRole('admin'), trainerController.getTrainerById);
router.put('/:id', verifyToken, requireRole('admin'), trainerController.updateTrainer);
router.delete('/:id', verifyToken, requireRole('admin'), trainerController.deleteTrainer);

module.exports = router;