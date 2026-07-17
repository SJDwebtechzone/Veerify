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
// Student updates their OWN profile (users + student_profiles merge).
// Institution-managed fields (belt, enrollment, institution) live on
// other tables and aren't touched.
router.patch('/me/profile', verifyToken, requireRole('student'), enrollmentController.updateMyProfile);
router.delete('/:id', verifyToken, requireRole('student'), enrollmentController.cancelEnrollment);
router.patch('/:id/payment', verifyToken, requireRole('student'), enrollmentController.markPaid);
// Mock payment — dev-only fallback for when Razorpay isn't configured.
// The mobile invokes this ONLY when create-payment-link responded with
// { mock: true }. In production this path is never hit.
router.post('/:id/mock-pay', verifyToken, requireRole('student'), enrollmentController.mockPay);

// NEW-enrollment payment — student completes the enrollment form, the
// mobile POSTs /enrollments (row lands as payment_status='pending'),
// then hits this endpoint to mint a Razorpay Payment Link. The mobile
// opens the returned URL in the in-app browser; the shared Razorpay
// webhook (/api/payments/webhook) flips the row to 'paid' via the
// notes.action='enrollment_new' branch. Mobile polls /payment-status
// after the browser returns to detect completion.
router.post('/:id/create-payment-link',
  verifyToken, requireRole('student'),
  enrollmentController.createEnrollmentPaymentLink);
router.get('/:id/payment-status',
  verifyToken, requireRole('student'),
  enrollmentController.paymentStatus);

// Admin re-mints and re-emails the Razorpay Payment Link for a
// pending enrolment. Powers the "Resend link" button on the admin
// Students / enrolment details screens.
router.post('/:id/resend-payment-link',
  verifyToken, requireRole('admin'),
  enrollmentController.resendPaymentLink);

// Student-initiated renewal — mints a Razorpay payment link scoped to
// the student. Mobile opens the returned URL in the browser; the
// existing Razorpay webhook flips payment_status to 'paid' on success.
router.post('/:id/renew',         verifyToken, requireRole('student'), enrollmentController.renewEnrollment);
router.get('/:id/renewal-status', verifyToken, requireRole('student'), enrollmentController.renewalStatus);

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