// backend/src/routes/institutionBanner.routes.js
//
// Per-institution promotional banners. Mounted by server.js under
// /api/institution-banners.

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/institutionBanner.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Admin-scoped CRUD — every operation is bound to the caller's
// institution_id inside the controller.
router.get('/',        verifyToken, requireRole('admin'), ctrl.listMine);
router.post('/',       verifyToken, requireRole('admin'), ctrl.create);
router.put('/:id',     verifyToken, requireRole('admin'), ctrl.update);
router.delete('/:id',  verifyToken, requireRole('admin'), ctrl.remove);

// Consumer-side read — student, trainer, parent see only active banners
// targeted at their role at their linked institution.
router.get('/for-me',  verifyToken,
           requireRole('student', 'trainer', 'parent'),
           ctrl.forMe);

// Public read — guest browsing an academy profile card sees the active
// student-facing banners without needing to log in. Powers the branded
// hero banner on the Guest → Academy Search → InstitutionDetail screen.
router.get('/public/:institutionId', ctrl.publicList);

module.exports = router;
