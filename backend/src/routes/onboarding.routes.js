const express = require('express');
const router = express.Router();
const onboardingController = require('../controllers/onboarding.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// ── Academy admin routes ──
router.post('/select-plan',     verifyToken, requireRole('admin'), onboardingController.selectPlan);
router.post('/setup',           verifyToken, requireRole('admin'), onboardingController.setupAcademy);
router.get('/my-status',        verifyToken, requireRole('admin'), onboardingController.getMyStatus);
router.get('/subscription-status', verifyToken, requireRole('admin'), onboardingController.getSubscriptionStatus);
router.post('/mock-payment',    verifyToken, requireRole('admin'), onboardingController.mockPayment);
// Renewal / upgrade / downgrade — generates a fresh Razorpay payment
// link. Body may include `plan_id` to switch plans; if omitted or same
// as the current plan, this is a straight renewal.
router.post('/renew',           verifyToken, requireRole('admin'), onboardingController.createRenewalPaymentLink);
// Payment history — every renew / upgrade / downgrade / onboarding row.
router.get('/payment-history',  verifyToken, requireRole('admin'), onboardingController.listPaymentHistory);
// Public term-picker landing page + Razorpay redirect the approval
// email links to. No auth: the URL carries the institution id + owner
// arrives from their own inbox. Two modes on the same URL:
//   /pay-approval/:instId               → renders HTML picker page
//   /pay-approval/:instId?term=monthly  → mints link + 302 → Razorpay
router.get('/pay-approval/:institutionId', onboardingController.startApprovalPayment);
// Admin walks away from Razorpay before paying → mark the still-pending
// row 'cancelled' so History reflects the truth.
router.post('/mark-payment-cancelled', verifyToken, requireRole('admin'), onboardingController.markPaymentCancelled);

// Owner self-delete + restore + start-over (mounted under /me so they don't
// clash with the super-admin /:id routes).
router.delete('/me',            verifyToken, requireRole('admin'), onboardingController.deleteMyInstitution);
router.post('/me/restore',      verifyToken, requireRole('admin'), onboardingController.restoreMyInstitution);
router.post('/me/start-over',   verifyToken, requireRole('admin'), onboardingController.startOverMyInstitution);

// ── Super admin routes ──
// Specific static paths MUST come before /:id so Express doesn't capture them as ids.
router.get('/all',     verifyToken, onboardingController.getAllInstitutions);
router.get('/pending', verifyToken, onboardingController.getPendingInstitutions);
router.get('/counts',  verifyToken, onboardingController.getOnboardingCounts);
// Subscription payments made by institutions (recent first). Static path -
// must come before /:id below.
router.get('/recent-payments', verifyToken, onboardingController.getRecentInstitutionPayments);
// Full subscription-payments ledger — powers Web Admin → Payments →
// Subscription Payments. Static path, must come before /:id.
router.get('/subscription-payments', verifyToken, onboardingController.listSubscriptionPayments);
// Broadcast notification across many institutions (also a static path - must
// come before /:id below).
router.post('/notify-bulk', verifyToken, onboardingController.notifyInstitutionsBulk);
// Bulk soft-delete (static path - must come before /:id below).
router.post('/bulk-delete', verifyToken, onboardingController.bulkDeleteInstitutions);
router.get('/:id',     verifyToken, onboardingController.getInstitutionById);

router.post('/approve/:id',             verifyToken, onboardingController.approveInstitution);
router.post('/reject/:id',              verifyToken, onboardingController.rejectInstitution);
router.post('/activate/:id',            verifyToken, onboardingController.activateInstitution);
router.post('/resend-payment-link/:id', verifyToken, onboardingController.resendPaymentLink);
router.post('/toggle-active/:id',       verifyToken, onboardingController.toggleInstitutionActive);
router.post('/:id/restore',             verifyToken, onboardingController.restoreInstitution);
// Super admin -> institution owner notification (lands in the owner's mobile inbox).
router.post('/:id/notify',              verifyToken, onboardingController.notifyInstitution);
// Super admin: edit any institution's details (Core / Contact / Accreditation /
// Operations / Master) — used when filling in fields on behalf of a branch
// whose parent only provided basic info.
router.put('/:id/super-admin-edit', verifyToken, onboardingController.superAdminEditInstitution);
// Sub-branch credential recovery — rotates the branch admin's password
// and re-emails it. Used when the original setup email got lost / went
// to spam / never arrived.
router.post('/:id/resend-branch-credentials', verifyToken, onboardingController.resendBranchCredentials);
// Sister of resend-branch-credentials — operates on a branch INDEX inside
// the parent's JSONB branches[]. Provisions the child institution +
// user row on first call if it doesn't exist yet, otherwise just rotates
// the password and resends the email.
router.post('/:parentId/provision-branch', verifyToken, onboardingController.provisionOrResendBranch);
router.delete('/:id',                   verifyToken, onboardingController.deleteInstitution);

module.exports = router;
