const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/certificate.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// PUBLIC verification — no auth so a QR scan from any device works.
router.get('/verify/:token', ctrl.verify);

// Authed reads.
router.get('/my',                    verifyToken, requireRole('student'), ctrl.listMy);
router.get('/student/:studentId',    verifyToken, ctrl.listForStudent);
router.get('/:id',                   verifyToken, ctrl.getById);

module.exports = router;
