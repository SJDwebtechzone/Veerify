const express = require('express');
const router = express.Router();
const institutionController = require('../controllers/institution.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../utils/subscriptionGuard');

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
router.post('/me/events',          verifyToken, requireRole('admin'), requireActiveSubscription, institutionController.createInstitutionEvent);
// PUT /me/events/:eventId — institution admin edits their own event
// while it's still awaiting super-admin approval. Only intra events
// with approval_status='pending' are editable; the endpoint 403s in
// every other case (approved, rejected, wrong owner, or inter type).
router.put('/me/events/:eventId',  verifyToken, requireRole('admin'), institutionController.updateInstitutionEvent);
// /events/:eventId/pay — student / trainer taps Pay Now; server mints a
// Razorpay Payment Link and returns short_url for the app to open. Sits
// as a literal /events/... path so it doesn't collide with /:id/events.
router.post('/events/:eventId/pay', verifyToken, institutionController.payForInstitutionEvent);
// /events/:eventId/payment-status — polled by the mobile after the
// payer returns from Razorpay. Reports paid | pending | failed | none
// so the client can flip UI to Registered without waiting for the next
// full events refetch.
router.get('/events/:eventId/payment-status', verifyToken, institutionController.getEventPaymentStatus);

// /events/:eventId/payment-success — Razorpay redirects the payer
// here after successful checkout. PUBLIC (no auth) — the URL carries
// the event id + user id needed to reconcile. Actively verifies with
// Razorpay's API, flips the row to paid if confirmed, renders a
// branded success page. Guarantees the row is never stuck at
// 'pending' after a genuine paid charge, even if the webhook fails.
router.get('/events/:eventId/payment-success', institutionController.eventPaymentSuccess);

// Branch → Parent event approval flow.
//   GET  /me/events/pending — parent admin lists pending branch events.
//   PATCH /events/:eventId/approve — parent admin approves a branch event.
//   PATCH /events/:eventId/reject  — parent admin rejects, optional reason.
router.get('/me/events/pending',       verifyToken, requireRole('admin'), institutionController.listPendingBranchEvents);
router.patch('/events/:eventId/approve', verifyToken, requireRole('admin'), institutionController.approveBranchEvent);
router.patch('/events/:eventId/reject',  verifyToken, requireRole('admin'), institutionController.rejectBranchEvent);
// /me/support-email — role-agnostic. Any authenticated caller resolves
// to their OWN institution's contact email (via institution_id on the
// users row, walked up to the parent when the caller is enrolled at a
// sub-branch). Powers the Support screen so students, trainers, and
// admins can see the correct academy support email without exposing
// any other institution's data.
router.get('/me/support-email',    verifyToken, institutionController.getMySupportEmail);

// /me/details + /me/update — admin's own institution.
router.get('/me/details',          verifyToken, requireRole('admin'), institutionController.getMyInstitution);
router.put('/me/update',           verifyToken, requireRole('admin'), requireActiveSubscription, institutionController.updateInstitution);
// /me/location — sub-branch admins (and main-branch admins) update just
// the location fields on their own institution row.
router.patch('/me/location',       verifyToken, requireRole('admin'), requireActiveSubscription, institutionController.updateMyLocation);
// /sub-branches/:id — main-branch admin edits a sub-branch's location
// + contact fields from their Branches list on the mobile app.
router.patch('/sub-branches/:id',  verifyToken, requireRole('admin'), requireActiveSubscription, institutionController.updateSubBranch);

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
