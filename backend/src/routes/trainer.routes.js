const express = require('express');
const router = express.Router();
const trainerController = require('../controllers/trainer.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Trainer's own profile (must come before /:id so it's not captured as an id).
router.get('/me', verifyToken, requireRole('trainer'), trainerController.getMe);

// Super admin - platform-wide trainers roster (also a static path - must
// come before /:id).
router.get('/all', verifyToken, trainerController.getAllTrainers);

// All other trainer routes are admin-only
router.post('/', verifyToken, requireRole('admin'), trainerController.createTrainer);
router.get('/', verifyToken, requireRole('admin'), trainerController.getMyTrainers);
router.get('/:id', verifyToken, requireRole('admin'), trainerController.getTrainerById);
router.put('/:id', verifyToken, requireRole('admin'), trainerController.updateTrainer);
router.delete('/:id', verifyToken, requireRole('admin'), trainerController.deleteTrainer);

module.exports = router;