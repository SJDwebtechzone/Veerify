// backend/src/routes/certificateTemplate.routes.js

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/certificateTemplate.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// ── Global sample templates (super-admin managed, institution-read) ──
// Must be declared BEFORE the /:id routes so Express doesn't capture
// "samples" as an :id param.
router.get('/samples',
  verifyToken, requireRole('admin', 'super_admin'),
  ctrl.listSamples);
router.post('/samples',
  verifyToken, requireRole('super_admin'),
  ctrl.createSample);
router.put('/samples/:id',
  verifyToken, requireRole('super_admin'),
  ctrl.updateSample);
router.delete('/samples/:id',
  verifyToken, requireRole('super_admin'),
  ctrl.removeSample);
router.patch('/samples/:id/default',
  verifyToken, requireRole('super_admin'),
  ctrl.setSampleDefault);
// Institution admin "Use as Template" — clones the sample into their
// own templates. The original sample stays untouched (spec).
router.post('/samples/:id/copy',
  verifyToken, requireRole('admin'),
  ctrl.copySample);

// ── Institution-owned templates ────────────────────────────────────
// Every template endpoint is institution-admin only. Sub-branch admins
// inherit the same rules (they can manage their own branch's templates).
router.get('/',                    verifyToken, requireRole('admin'), ctrl.list);
router.post('/',                   verifyToken, requireRole('admin'), ctrl.create);
router.put('/:id',                 verifyToken, requireRole('admin'), ctrl.update);
router.delete('/:id',              verifyToken, requireRole('admin'), ctrl.remove);
router.post('/:id/default',        verifyToken, requireRole('admin'), ctrl.setDefault);
router.post('/:id/prepare',        verifyToken, requireRole('admin'), ctrl.prepare);

module.exports = router;
