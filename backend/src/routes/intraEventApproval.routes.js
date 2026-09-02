// src/routes/intraEventApproval.routes.js
//
// Super-admin (web console) routes for the Intra-Level event
// approval queue. Mounted at /api/intra-events by server.js.

const express = require('express');
const router  = express.Router();

const { verifyToken }  = require('../middleware/auth.middleware');
const { requireRole }  = require('../middleware/role.middleware');
const ctrl             = require('../controllers/intraEventApproval.controller');

// Cheap "just the number" endpoint — polled by the Web Admin's
// sidebar badge and notification bell. Kept ahead of /:id/* so the
// literal path 'pending-count' wins the router.
router.get('/pending-count', verifyToken, requireRole('super_admin'), ctrl.pendingCount);
router.get('/pending',       verifyToken, requireRole('super_admin'), ctrl.listPending);
router.get('/',              verifyToken, requireRole('super_admin'), ctrl.listAll);
// Full-detail fetch used by the "View full details" modal so every
// persisted column is available even when the list endpoint returns
// a narrower shape. Kept above the mutating POSTs for readability.
router.get('/:id',           verifyToken, requireRole('super_admin'), ctrl.getOne);
router.post('/:id/approve',  verifyToken, requireRole('super_admin'), ctrl.approve);
router.post('/:id/reject',   verifyToken, requireRole('super_admin'), ctrl.reject);

module.exports = router;
