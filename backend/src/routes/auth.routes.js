const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyToken } = require('../middleware/auth.middleware');

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);

// Protected route - get logged-in user info
router.get('/me', verifyToken, authController.getMe);

// Change own password
router.post('/change-password', verifyToken, authController.changePassword);

module.exports = router;