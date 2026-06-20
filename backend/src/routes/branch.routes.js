// backend/src/routes/branch.routes.js
//
// Institution-branch CRUD + the public "nearby" search the student app
// hits with the device's coords.
//
// Auth:
//   • /nearby is public — no token required (students can browse anonymously).
//   • All other paths require admin role; the controller enforces
//     "branch must belong to caller's institution" per request.

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/branch.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Public nearby — must come BEFORE the verifyToken-mounted routes below.
router.get('/nearby', ctrl.getNearby);

router.get('/',        verifyToken, requireRole('admin'), ctrl.listMine);
router.post('/',       verifyToken, requireRole('admin'), ctrl.create);
router.put('/:id',     verifyToken, requireRole('admin'), ctrl.update);
router.delete('/:id',  verifyToken, requireRole('admin'), ctrl.remove);

module.exports = router;
