// backend/src/routes/faq.routes.js
//
// Dynamic FAQ module.
//   /api/faqs             — public list (role-scoped via optional JWT).
//   /api/faqs/admin       — super-admin only; every row.
//   /api/faqs/:id, etc.   — super-admin CRUD + toggle active.
//
// The public list intentionally has NO auth middleware so guest
// callers can hit it without a token. The controller peeks at the
// Authorization header itself and falls back to 'guest' when no
// valid token is present.

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/faq.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.get('/',        ctrl.listPublic);
router.get('/admin',   verifyToken, requireRole('super_admin'), ctrl.listAdmin);
router.post('/',       verifyToken, requireRole('super_admin'), ctrl.create);
router.put('/:id',     verifyToken, requireRole('super_admin'), ctrl.update);
router.patch('/:id/active', verifyToken, requireRole('super_admin'), ctrl.setActive);
router.delete('/:id',  verifyToken, requireRole('super_admin'), ctrl.remove);

module.exports = router;
