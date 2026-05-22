const express = require('express');
const router = express.Router();
const institutionController = require('../controllers/institution.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// ── Public routes (no login needed) ──
// IMPORTANT: specific paths come before /:id so Express doesn't capture
// "nearby", "me", etc. as an institution id.
router.get('/nearby',              institutionController.getNearbyInstitutions);
router.get('/',                    institutionController.getAllInstitutions);

// Student-facing institution-scoped browse endpoints (also public — guests
// can browse without an account).
router.get('/:id/programs',        institutionController.getInstitutionPrograms);
router.get('/:id/batches',         institutionController.getInstitutionBatches);
router.get('/:id/trainers',        institutionController.getInstitutionTrainers);
router.get('/:id/live-classes',    institutionController.getInstitutionLiveClasses);
router.get('/:id/events',          institutionController.getInstitutionEvents);

router.get('/:id',                 institutionController.getInstitutionById);

// ── Admin-only protected routes ──
router.post('/',                   verifyToken, requireRole('admin'), institutionController.createInstitution);
router.get('/me/details',          verifyToken, requireRole('admin'), institutionController.getMyInstitution);
router.put('/me/update',           verifyToken, requireRole('admin'), institutionController.updateInstitution);

module.exports = router;
