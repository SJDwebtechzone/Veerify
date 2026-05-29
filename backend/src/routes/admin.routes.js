const express = require('express');
const router = express.Router();

const adminController = require('../controllers/admin.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// All admin-dashboard endpoints require an authenticated institution admin.
router.get('/dashboard', verifyToken, requireRole('admin'), adminController.getDashboardStats);

module.exports = router;
