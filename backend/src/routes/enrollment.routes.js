const express = require('express');
const router = express.Router();
const enrollmentController = require('../controllers/enrollment.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../utils/subscriptionGuard');

// Enrollment create — allowed for BOTH students (self-enrolment from the
// course detail screen) AND admins (institution-admin enrolling a student
// via the Students-tab FAB → EnrollmentForm with adminMode=true). The
// controller branches on req.user.role + admin_mode flag: students enrol
// themselves directly, admins create a new student account first then
// link the enrolment to that user.
router.post('/', verifyToken, requireRole('student', 'admin'), requireActiveSubscription, enrollmentController.enrollInBatch);
router.get('/my', verifyToken, requireRole('student'), enrollmentController.getMyEnrollments);
router.get('/my-profile', verifyToken, requireRole('student'), enrollmentController.getMyProfile);
router.delete('/:id', verifyToken, requireRole('student'), enrollmentController.cancelEnrollment);
router.patch('/:id/payment', verifyToken, requireRole('student'), enrollmentController.markPaid);
// Mock payment - flips status to paid. Replace with Razorpay webhook later.
router.post('/:id/mock-pay', verifyToken, requireRole('student'), enrollmentController.mockPay);

// Admin/trainer route — enrollments for a single batch
router.get('/batch/:id', verifyToken, requireRole('admin', 'trainer'), enrollmentController.getEnrollmentsByBatch);

// Trainer-only — one-shot roster of every student across every batch the
// trainer teaches. Powers "View Students" on the trainer login. Returns
// full detail (name, phone, photo, course, batch, branch, payment) plus
// a `has_batches` flag so the UI can show the right empty state.
router.get('/trainer/my-students',
  verifyToken,
  requireRole('trainer'),
  enrollmentController.getStudentsForMyTrainerBatches);
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

// Admin-only — update a student's profile (name/email/phone + profile fields)
// Used by StudentDetailScreen edit pencil.
router.patch('/student/:userId',
  verifyToken,
  requireRole('admin'),
  enrollmentController.updateStudentByAdmin);

// Admin-only — soft-delete a student (institution + branch login).
// Used by the Students tab delete action. Mirrors the trainer-delete
// pattern (marks users.is_deleted = TRUE, status = 'inactive') so
// enrolments / attendance stay intact while the email/phone become
// reusable via the partial-unique indexes from migration 050.
router.delete('/student/:userId',
  verifyToken,
  requireRole('admin'),
  enrollmentController.deleteStudentByAdmin);

module.exports = router;