const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/referral.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Read settings — any logged-in user (mobile reads to show defaults).
router.get('/settings',          verifyToken, ctrl.getSettings);

// Institution-admin routes.
router.get('/me',                verifyToken, requireRole('admin'), ctrl.getMe);
router.post('/regenerate-code',  verifyToken, requireRole('admin'), ctrl.regenerateCode);
router.post('/apply',            verifyToken, requireRole('admin'), ctrl.apply);
router.get('/history',           verifyToken, requireRole('admin'), ctrl.history);
router.get('/transactions',      verifyToken, requireRole('admin'), ctrl.transactions);

// Super-admin routes.
router.put('/settings',          verifyToken, requireRole('super_admin'), ctrl.updateSettings);
router.get('/admin/stats',       verifyToken, requireRole('super_admin'), ctrl.adminStats);

module.exports = router;
