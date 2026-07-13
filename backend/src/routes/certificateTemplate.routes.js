// backend/src/routes/certificateTemplate.routes.js

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/certificateTemplate.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Every template endpoint is institution-admin only. Sub-branch admins
// inherit the same rules (they can manage their own branch's templates).
router.get('/',                    verifyToken, requireRole('admin'), ctrl.list);
router.post('/',                   verifyToken, requireRole('admin'), ctrl.create);
router.put('/:id',                 verifyToken, requireRole('admin'), ctrl.update);
router.delete('/:id',              verifyToken, requireRole('admin'), ctrl.remove);
router.post('/:id/default',        verifyToken, requireRole('admin'), ctrl.setDefault);
router.post('/:id/prepare',        verifyToken, requireRole('admin'), ctrl.prepare);

module.exports = router;
