const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/courseVideo.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Trainer or admin uploads
router.post('/',          verifyToken, requireRole('trainer', 'admin'), ctrl.create);

// Anyone with batch access reads (controller validates: admin of inst, assigned trainer, or paid-enrolled student)
router.get('/batch/:id',  verifyToken, ctrl.listByBatch);

// Uploader (trainer) or institution admin deletes
router.delete('/:id',     verifyToken, requireRole('trainer', 'admin'), ctrl.remove);

module.exports = router;
