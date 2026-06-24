const express = require('express');
const router = express.Router();
const institutionController = require('../controllers/institution.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// ─────────────────────────────────────────────────────────────────────────
// ROUTE ORDERING — READ THIS BEFORE ADDING NEW ROUTES.
//
// Express matches routes in declaration order. /:id captures ANY string,
// so /:id/events would catch a request to /me/events (with id="me") and
// then the controller would try to use "me" as a Postgres integer, which
// throws "invalid input syntax for type integer".
//
// Rule: every LITERAL path (`/me/...`, `/nearby`, etc.) must come BEFORE
// the corresponding `/:id/...` parametric route.
// ─────────────────────────────────────────────────────────────────────────

// ── Public literal paths first ──
router.get('/nearby',              institutionController.getNearbyInstitutions);
router.get('/',                    institutionController.getAllInstitutions);

// ── Auth-required literal /me/... paths — must come BEFORE /:id/... ──
// /me/events: caller's institution-scoped events + globals. Used by the
// student + trainer home screens.
router.get('/me/events',           verifyToken, institutionController.getMyEvents);
// /me/events/all: admin-only history view (past + upcoming).
router.get('/me/events/all',       verifyToken, requireRole('admin'), institutionController.listMyInstitutionEvents);
// /me/events (POST): admin creates an event for their own institution.
router.post('/me/events',          verifyToken, requireRole('admin'), institutionController.createInstitutionEvent);
// /me/details + /me/update — admin's own institution.
router.get('/me/details',          verifyToken, requireRole('admin'), institutionController.getMyInstitution);
router.put('/me/update',           verifyToken, requireRole('admin'), institutionController.updateInstitution);

// ── Student-facing institution-scoped browse endpoints (public — guests
//    can browse without an account). These come AFTER the /me/... routes
//    so "me" can't be captured as an integer id.
router.get('/:id/programs',        institutionController.getInstitutionPrograms);
router.get('/:id/batches',         institutionController.getInstitutionBatches);
router.get('/:id/trainers',        institutionController.getInstitutionTrainers);
router.get('/:id/live-classes',    institutionController.getInstitutionLiveClasses);
router.get('/:id/events',          institutionController.getInstitutionEvents);

router.get('/:id',                 institutionController.getInstitutionById);

// ── Other admin-only protected routes ──
router.post('/',                   verifyToken, requireRole('admin'), institutionController.createInstitution);

module.exports = router;
