const express = require('express');
const router = express.Router();

const announcementController = require('../controllers/announcement.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// All announcement endpoints are institution-admin only.
router.get('/audience-counts', verifyToken, requireRole('admin'), announcementController.audienceCounts);
router.post('/',               verifyToken, requireRole('admin'), announcementController.send);

module.exports = router;
