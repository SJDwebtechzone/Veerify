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

// "Accessible branches" — list every institution under the same main-
// branch group as the caller's home institution. Drives the trainer
// Students-tab branch picker. Open to any signed-in role; the response
// is scoped per-user via the JWT.
router.get('/accessible', verifyToken, ctrl.listAccessibleBranches);

router.get('/',            verifyToken, requireRole('admin'), ctrl.listMine);
// Read-only Branch Dashboard — aggregated students / revenue / attendance
// for a single sub-branch. Powers the "tap a branch card → drill-in"
// flow on the mobile Branches list.
router.get('/:id/dashboard', verifyToken, requireRole('admin'), ctrl.getBranchDashboard);
router.post('/',           verifyToken, requireRole('admin'), ctrl.create);
router.put('/:id',         verifyToken, requireRole('admin'), ctrl.update);
router.delete('/:id',      verifyToken, requireRole('admin'), ctrl.remove);

module.exports = router;
