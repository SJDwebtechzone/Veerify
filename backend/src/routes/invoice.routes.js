// backend/src/routes/invoice.routes.js
//
// Auth-gated invoice download + metadata endpoints. Every route
// requires a valid JWT; the controller further verifies the caller
// actually owns the invoice before streaming the PDF.

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/invoice.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.get('/mine',
  verifyToken, requireRole('student', 'admin', 'super_admin'),
  ctrl.listMine);

router.get('/enrollment/:enrollmentId',
  verifyToken, requireRole('student', 'admin', 'super_admin'),
  ctrl.getForEnrollment);

router.get('/subscription/:institutionId',
  verifyToken, requireRole('admin', 'super_admin'),
  ctrl.getForSubscription);

router.get('/:id/pdf',
  verifyToken, requireRole('student', 'admin', 'super_admin'),
  ctrl.downloadPdf);

module.exports = router;
