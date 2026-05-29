const express = require('express');
const router = express.Router();
const parentController = require('../controllers/parent.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Parent routes
router.post('/link-child', verifyToken, requireRole('parent'), parentController.linkChild);
router.get('/children', verifyToken, requireRole('parent'), parentController.getMyChildren);
router.delete('/children/:childId', verifyToken, requireRole('parent'), parentController.unlinkChild);
router.get('/children/:childId/summary', verifyToken, requireRole('parent'), parentController.getChildSummary);
router.get('/children/:childId/enrollments', verifyToken, requireRole('parent'), parentController.getChildEnrollments);
router.get('/children/:childId/attendance', verifyToken, requireRole('parent'), parentController.getChildAttendance);
router.get('/children/:childId/payments', verifyToken, requireRole('parent'), parentController.getChildPayments);

// Student routes (for approving/rejecting parent requests)
router.get('/pending-requests', verifyToken, requireRole('student'), parentController.getMyPendingRequests);
router.patch('/approve/:linkId', verifyToken, requireRole('student'), parentController.approveParent);
router.patch('/reject/:linkId', verifyToken, requireRole('student'), parentController.rejectParent);

// Admin routes — institution-managed parent-child links
router.post('/admin-link',     verifyToken, requireRole('admin'), parentController.adminLink);
router.get('/admin-links',     verifyToken, requireRole('admin'), parentController.adminListLinks);
router.delete('/admin-links/:id', verifyToken, requireRole('admin'), parentController.adminUnlink);

module.exports = router;