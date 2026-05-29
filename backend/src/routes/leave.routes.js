const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/leave.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Student / parent — create a request.
router.post('/',          verifyToken, requireRole('student', 'parent'), leaveController.create);

// Student — own history.
router.get('/my',         verifyToken, requireRole('student'),           leaveController.getMy);

// Parent — leave history across linked children.
router.get('/parent/my-children', verifyToken, requireRole('parent'),    leaveController.getForParent);

// Trainer — review queue + counts.
router.get('/trainer/my', verifyToken, requireRole('trainer'),           leaveController.getForTrainer);

// Trainer / admin — approve / reject.
router.post('/:id/approve', verifyToken, requireRole('trainer', 'admin'), leaveController.approve);
router.post('/:id/reject',  verifyToken, requireRole('trainer', 'admin'), leaveController.reject);

module.exports = router;
