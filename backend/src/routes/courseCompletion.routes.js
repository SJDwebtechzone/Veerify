// backend/src/routes/courseCompletion.routes.js
//
// Mounted under /api/course-completions in server.js.

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/courseCompletion.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Trainer flows
router.post('/',                          verifyToken, requireRole('trainer'), ctrl.recordCourseCompletion);
router.get('/trainer/mine',               verifyToken, requireRole('trainer'), ctrl.listTrainerCompletions);
router.patch('/:id/remarks',              verifyToken, requireRole('trainer'), ctrl.submitTestRemarks);

// Institution admin flows
router.get('/institution/awaiting-certificate',
                                          verifyToken, requireRole('admin'),
                                          ctrl.listInstitutionAwaitingCertificate);
router.post('/:id/send-certificate',      verifyToken, requireRole('admin'), ctrl.sendCertificate);

module.exports = router;
