const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendance.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Trainer routes
router.post('/', verifyToken, requireRole('trainer'), attendanceController.markAttendance);
router.post('/bulk', verifyToken, requireRole('trainer'), attendanceController.markBulkAttendance);

// Trainer/admin route
router.get('/batch/:id', verifyToken, requireRole('admin', 'trainer'), attendanceController.getAttendanceByBatch);

// Student route
router.get('/my', verifyToken, requireRole('student'), attendanceController.getMyAttendance);

module.exports = router;