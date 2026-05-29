const express = require('express');
const router = express.Router();
const enrollmentController = require('../controllers/enrollment.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Student routes
router.post('/', verifyToken, requireRole('student'), enrollmentController.enrollInBatch);
router.get('/my', verifyToken, requireRole('student'), enrollmentController.getMyEnrollments);
router.delete('/:id', verifyToken, requireRole('student'), enrollmentController.cancelEnrollment);
router.patch('/:id/payment', verifyToken, requireRole('student'), enrollmentController.markPaid);

// Admin/trainer route — enrollments for a single batch
router.get('/batch/:id', verifyToken, requireRole('admin', 'trainer'), enrollmentController.getEnrollmentsByBatch);
// Admin-only — aggregated enrollments across every batch of a course
router.get('/course/:id', verifyToken, requireRole('admin'), enrollmentController.getEnrollmentsByCourse);

module.exports = router;