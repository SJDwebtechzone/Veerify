const express = require('express');
const router = express.Router();

const adminController = require('../controllers/admin.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// All admin-dashboard endpoints require an authenticated institution admin.
router.get('/dashboard', verifyToken, requireRole('admin'), adminController.getDashboardStats);

// Full Recent Activity feed for the "See all" screen. Same branch
// scope as the dashboard so branch admins see only their branch;
// main-institution admins see the whole academy (or a picked branch
// via ?branch_id=).
router.get('/recent-activity', verifyToken, requireRole('admin'), adminController.getRecentActivity);

// Monthly revenue Details drilldown — per-month totals + counts and
// the individual payment ledger for the window. Same revenueScope as
// the dashboard chart so month totals CAN'T disagree between the two
// surfaces. Supports ?months=, ?before=, ?branch_id=.
router.get('/revenue-details', verifyToken, requireRole('admin'), adminController.getRevenueDetails);

module.exports = router;
