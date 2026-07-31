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
// Backend fallback for the post-payment landing page. Razorpay is
// configured to redirect to `${WEB_APP_URL}/payment-success` — the
// real frontend route. This endpoint exists so an ops team can add a
// simple nginx rewrite `/payment-success → /api/onboarding/payment-success`
// when the frontend isn't deployed yet, and no payer ever lands on a
// raw 404 after successfully paying.
router.get('/payment-success', onboardingController.renderPaymentSuccessPage);
// Active verify path — mobile / web calls this to force the backend
// to re-check the Razorpay Payment Link status and activate the
// institution on the spot when it's paid. Belt-and-braces for a
// lost / delayed webhook. Public + optional-auth so the mobile can
// call it right after login (before the JWT even lands on the client).
router.post('/verify-payment', onboardingController.verifyPayment);
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

// Institution approval is a SUPER-ADMIN-only action. Previously the
// route only required verifyToken, which meant any authenticated user
// could POST /approve/:id and flip a pending institution to approved.
router.post('/approve/:id',             verifyToken, requireRole('super_admin'), onboardingController.approveInstitution);
// Manual retry of the approval email + payment link — used when the
// first send failed because SMTP or Razorpay creds weren't loaded.
// Never approves; requires the row to already be `approved` (fails
// with 409 ALREADY_ACTIVE if the webhook has already activated it).
router.post('/resend-approval/:id',     verifyToken, requireRole('super_admin'), onboardingController.resendApprovalEmail);
router.post('/reject/:id',              verifyToken, onboardingController.rejectInstitution);
// Manual activation is a SUPER-ADMIN ONLY override for institutions
// that paid via a channel Razorpay didn't observe (offline bank
// transfer, cheque, ops-side reconciliation). Everyone else must go
// through the Razorpay webhook, which is the only automated path.
// The role gate closes a legacy hole where any authenticated caller
// could POST /activate/:id and grant an unpaid institution access.
router.post('/activate/:id',            verifyToken, requireRole('super_admin'), onboardingController.activateInstitution);
router.post('/resend-payment-link/:id', verifyToken, onboardingController.resendPaymentLink);
router.post('/toggle-active/:id',       verifyToken, onboardingController.toggleInstitutionActive);
router.post('/:id/restore',             verifyToken, onboardingController.restoreInstitution);
// Super admin -> institution owner notification (lands in the owner's mobile inbox).
router.post('/:id/notify',              verifyToken, onboardingController.notifyInstitution);
// Super admin: edit any institution's details (Core / Contact / Accreditation /
// Operations / Master) — used when filling in fields on behalf of a branch
// whose parent only provided basic info.
router.put('/:id/super-admin-edit', verifyToken, onboardingController.superAdminEditInstitution);
// Super admin: manually provision credentials for post-registration branches
router.post('/:id/send-branch-credentials', verifyToken, requireRole('super_admin'), onboardingController.sendBranchCredentials);
// Sub-branch credential recovery — rotates the branch admin's password
// and re-emails it. Used when the original setup email got lost / went
// to spam / never arrived.
router.post('/:id/resend-branch-credentials', verifyToken, requireRole('super_admin'), onboardingController.resendBranchCredentials);
// Sister of resend-branch-credentials — operates on a branch INDEX inside
// the parent's JSONB branches[]. Provisions the child institution +
// user row on first call if it doesn't exist yet, otherwise just rotates
// the password and resends the email.
router.post('/:parentId/provision-branch', verifyToken, onboardingController.provisionOrResendBranch);
router.delete('/:id',                   verifyToken, onboardingController.deleteInstitution);

module.exports = router;
