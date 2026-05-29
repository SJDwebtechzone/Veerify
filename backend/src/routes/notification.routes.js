const express = require('express');
const router = express.Router();
const notif = require('../controllers/notification.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Inbox (any logged-in user reads their own).
router.get('/',           verifyToken, notif.list);
router.post('/:id/read',  verifyToken, notif.markRead);
router.post('/read-all',  verifyToken, notif.markAllRead);
router.delete('/:id',     verifyToken, notif.remove);

// Send an announcement (trainer for own batch, admin for own institution).
router.post('/announce',  verifyToken, requireRole('trainer', 'admin'), notif.announce);

module.exports = router;
