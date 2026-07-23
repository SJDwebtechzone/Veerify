// backend/src/routes/legalPage.routes.js
//
// Legal / policy pages — platform-wide (super-admin) + per-institution.
// Mounted by server.js under /api/legal-pages.

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/legalPage.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// ── Public (no-auth) — single published platform page ───────────────
// Used by the web app's /privacy-policy, /terms-and-conditions, and
// /refund-cancellation-policy pages which are accessible without login.
router.get('/public/:slug', ctrl.getPublicPage);

// ── Super-admin scope — platform-wide policies ──────────────────────
// Super-admin only. The institution admin ("admin" role) CAN'T touch
// platform-wide legal pages even though they use the same shared table.
router.get('/platform',
  verifyToken, requireRole('super_admin'),
  ctrl.listPlatform);
router.post('/platform',
  verifyToken, requireRole('super_admin'),
  ctrl.upsertPlatform);
router.delete('/platform/:slug',
  verifyToken, requireRole('super_admin'),
  ctrl.deletePlatform);


// ── Institution admin scope — own institution only ──────────────────
// The controller scopes every query by the caller's users.institution_id,
// so a hostile client can't reach another institution's rows.
router.get('/institution',
  verifyToken, requireRole('admin'),
  ctrl.listInstitution);
router.post('/institution',
  verifyToken, requireRole('admin'),
  ctrl.upsertInstitution);
router.delete('/institution/:slug',
  verifyToken, requireRole('admin'),
  ctrl.deleteInstitution);

// ── Consumer reads — role-gated visibility matrix ───────────────────
// Every signed-in role can hit these; the controller filters the
// returned slugs against the role's allowed set (see READ_MATRIX in
// the controller). Guest / unauthenticated callers get nothing —
// legal pages are gated behind a login by design.
router.get('/me/platform',
  verifyToken,
  requireRole('student', 'trainer', 'parent', 'admin', 'super_admin'),
  ctrl.listPublishedForMe);
router.get('/me/institution',
  verifyToken,
  requireRole('student', 'trainer', 'parent', 'admin', 'super_admin'),
  ctrl.listInstitutionForMe);

module.exports = router;
