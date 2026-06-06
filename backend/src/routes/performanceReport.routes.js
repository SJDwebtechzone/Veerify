const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/performanceReport.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Student — only their own published reports.
router.get('/my', verifyToken, requireRole('student'), ctrl.listMy);

// Trainer / admin — list across their scope, optional ?student_id= filter.
router.get('/', verifyToken, requireRole('trainer', 'admin'), ctrl.listForTrainer);

// Anyone permitted (auth check is inside) — fetch one by id.
router.get('/:id', verifyToken, ctrl.getById);

// Trainer / admin — write paths.
router.post('/',           verifyToken, requireRole('trainer', 'admin'), ctrl.create);
router.put('/:id',         verifyToken, requireRole('trainer', 'admin'), ctrl.update);
router.post('/:id/publish', verifyToken, requireRole('trainer', 'admin'), ctrl.publish);
router.delete('/:id',      verifyToken, requireRole('trainer', 'admin'), ctrl.remove);

module.exports = router;
