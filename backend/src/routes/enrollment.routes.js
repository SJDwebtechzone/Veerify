const express = require('express');
const router = express.Router();
const enrollmentController = require('../controllers/enrollment.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Student routes
router.post('/', verifyToken, requireRole('student'), enrollmentController.enrollInBatch);
router.get('/my', verifyToken, requireRole('student'), enrollmentController.getMyEnrollments);
router.get('/my-profile', verifyToken, requireRole('student'), enrollmentController.getMyProfile);
router.delete('/:id', verifyToken, requireRole('student'), enrollmentController.cancelEnrollment);
router.patch('/:id/payment', verifyToken, requireRole('student'), enrollmentController.markPaid);
// Mock payment - flips status to paid. Replace with Razorpay webhook later.
router.post('/:id/mock-pay', verifyToken, requireRole('student'), enrollmentController.mockPay);

// Admin/trainer route — enrollments for a single batch
router.get('/batch/:id', verifyToken, requireRole('admin', 'trainer'), enrollmentController.getEnrollmentsByBatch);
// Admin-only — aggregated enrollments across every batch of a course
router.get('/course/:id', verifyToken, requireRole('admin'), enrollmentController.getEnrollmentsByCourse);
// Super admin — latest enrollments across all institutions (dashboard)
router.get('/all', verifyToken, enrollmentController.getAllEnrollments);

// Institution admin — every enrollment in their own institution, with
// student details + payment fields. Used by the mobile Earnings + Students
// tabs to show real data instead of the legacy placeholder rows.
router.get('/institution/me',
  verifyToken,
  requireRole('admin'),
  enrollmentController.getEnrollmentsForMyInstitution);

module.exports = router;