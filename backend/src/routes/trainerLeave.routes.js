const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/trainerLeave.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Trainer — submit a leave-from-work request.
router.post('/',           verifyToken, requireRole('trainer'), ctrl.create);

// Trainer — own leave history.
router.get('/my',          verifyToken, requireRole('trainer'), ctrl.getMy);

// Institution admin — review queue for their institution.
router.get('/',            verifyToken, requireRole('admin'),   ctrl.getForAdmin);

// Institution admin — approve / reject.
router.post('/:id/approve', verifyToken, requireRole('admin'),  ctrl.approve);
router.post('/:id/reject',  verifyToken, requireRole('admin'),  ctrl.reject);

module.exports = router;
