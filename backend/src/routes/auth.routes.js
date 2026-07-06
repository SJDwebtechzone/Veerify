const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyToken } = require('../middleware/auth.middleware');

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);

// Forgot / reset password flow (public - no token, but rate-limited by OTP)
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Protected route - get logged-in user info
router.get('/me', verifyToken, authController.getMe);
// Super-admin "My Profile" editor — same shape as /me, plus org_name,
// org_logo_url and alt_phone editing. Role enforcement lives in the
// controller (only admin / super_admin are accepted).
router.put('/me/profile', verifyToken, authController.updateMyProfile);

// Change own password
router.post('/change-password', verifyToken, authController.changePassword);

module.exports = router;