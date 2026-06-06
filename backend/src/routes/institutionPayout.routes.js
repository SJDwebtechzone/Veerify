const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/institutionPayout.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Institution admin — their own wallet snapshot (mobile Earnings tab uses this).
// MUST come before the super-admin '/' route otherwise '/me/wallet' would be
// shadowed by the param-less GET route mounted on the same router.
router.get('/me/wallet', verifyToken, requireRole('admin'), ctrl.getMyWallet);

// Super admin — list every institution's payout state.
router.get('/', verifyToken, requireRole('super_admin'), ctrl.list);

// Super admin — mark an institution's outstanding amount as paid.
router.post('/:institution_id/mark-paid',
  verifyToken, requireRole('super_admin'), ctrl.markPaid);

module.exports = router;
