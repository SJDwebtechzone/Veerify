const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendance.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Mark / bulk-mark attendance. Both roles allowed:
//   • Trainer  → their own assigned batches only.
//   • Admin    → batches under their branch scope (main admin sees
//                main-institution batches; sub-branch admin sees only
//                their own branch's). The controller enforces the
//                boundary via getBranchScope().
// Every write is audited into attendance_history.
router.post('/',     verifyToken, requireRole('admin', 'trainer'), attendanceController.markAttendance);
router.post('/bulk', verifyToken, requireRole('admin', 'trainer'), attendanceController.markBulkAttendance);

// Trainer/admin — read the roster for a batch. Response now includes
// creator + updater name / role, and the last-updated timestamp.
router.get('/batch/:id', verifyToken, requireRole('admin', 'trainer'), attendanceController.getAttendanceByBatch);

// Full audit trail for a single attendance row. Reachable by any user
// with access to the parent batch (trainer or admin).
router.get('/:id/history', verifyToken, requireRole('admin', 'trainer'), attendanceController.getAttendanceHistory);

// Student route
router.get('/my', verifyToken, requireRole('student'), attendanceController.getMyAttendance);

module.exports = router;
