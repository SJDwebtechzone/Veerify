const express = require('express');
const router = express.Router();
const notif = require('../controllers/notification.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Inbox (any logged-in user reads their own).
router.get('/',              verifyToken, notif.list);
// Lightweight badge count for the floating GlobalNotificationBell.
// Must be defined BEFORE /:id/... routes so Express doesn't treat
// "unread-count" as an id param.
router.get('/unread-count',  verifyToken, notif.unreadCount);
router.post('/:id/read',     verifyToken, notif.markRead);
router.post('/read-all',     verifyToken, notif.markAllRead);
router.delete('/:id',     verifyToken, notif.remove);

// Sent history — what *this* user has dispatched, grouped per send event.
// Available to anyone who can send (trainer, admin, super-admin).
router.get('/sent',       verifyToken, notif.sent);

// Trainer announcement approvals.
// • pending-approval — admin queue of trainer drafts awaiting review.
// • my-pending       — trainer's view of their own submitted drafts.
// • :id/approve      — admin approves and fans out to recipients.
// • :id/reject       — admin rejects with optional reason.
router.get('/pending-approval',     verifyToken, requireRole('admin'),  notif.pendingApproval);
router.get('/my-pending',           verifyToken, requireRole('trainer'), notif.myPending);
// Single-draft detail read — admins for their own institution, trainers
// for their own drafts. Powers the tap-from-inbox deep link.
router.get('/pending/:id',          verifyToken, requireRole('admin', 'trainer'), notif.getPendingOne);
router.post('/pending/:id/approve', verifyToken, requireRole('admin'),  notif.approvePending);
router.post('/pending/:id/reject',  verifyToken, requireRole('admin'),  notif.rejectPending);

// Send an announcement (trainer for own batch, admin for own institution).
// Trainer calls are gated through pending_announcements behind the scenes;
// the route itself stays open so existing clients keep working.
router.post('/announce',  verifyToken, requireRole('trainer', 'admin'), notif.announce);

module.exports = router;
