// backend/src/routes/curriculum.routes.js
//
// Per-student curriculum progress endpoints. Mounted by server.js at
// /api/curriculum-progress.

const express = require('express');
const router  = express.Router();

const ctrl = require('../controllers/curriculum.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Read: trainers, admins, students (own only), parents (own child).
//        Controller's assertCanManage enforces per-row ownership.
// Write: trainer + admin only — students never tick their own checklist.
router.get('/',    verifyToken, requireRole('trainer', 'admin', 'student', 'parent'), ctrl.getProgress);
router.post('/',   verifyToken, requireRole('trainer', 'admin'), ctrl.markComplete);
router.delete('/', verifyToken, requireRole('trainer', 'admin'), ctrl.unmarkComplete);

module.exports = router;
