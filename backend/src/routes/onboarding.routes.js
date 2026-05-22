const express = require('express');
const router = express.Router();
const onboardingController = require('../controllers/onboarding.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// ── Academy admin routes ──
router.post('/select-plan',     verifyToken, requireRole('admin'), onboardingController.selectPlan);
router.post('/setup',           verifyToken, requireRole('admin'), onboardingController.setupAcademy);
router.get('/my-status',        verifyToken, requireRole('admin'), onboardingController.getMyStatus);
router.post('/mock-payment',    verifyToken, requireRole('admin'), onboardingController.mockPayment);

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
router.get('/:id',     verifyToken, onboardingController.getInstitutionById);

router.post('/approve/:id',             verifyToken, onboardingController.approveInstitution);
router.post('/reject/:id',              verifyToken, onboardingController.rejectInstitution);
router.post('/activate/:id',            verifyToken, onboardingController.activateInstitution);
router.post('/resend-payment-link/:id', verifyToken, onboardingController.resendPaymentLink);
router.post('/toggle-active/:id',       verifyToken, onboardingController.toggleInstitutionActive);
router.post('/:id/restore',             verifyToken, onboardingController.restoreInstitution);
router.delete('/:id',                   verifyToken, onboardingController.deleteInstitution);

module.exports = router;
