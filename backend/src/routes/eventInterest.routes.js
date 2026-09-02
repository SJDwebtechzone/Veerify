// src/routes/eventInterest.routes.js
//
// Student-facing "Are you interested?" endpoints. Mounted at /api
// by server.js (same style as the other event-scoped routes).

const express = require('express');
const router  = express.Router();

const { verifyToken } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/eventInterest.controller');

router.get('/events/:eventId/my-interest', verifyToken, ctrl.getMyInterest);
router.put('/events/:eventId/my-interest', verifyToken, ctrl.setMyInterest);

module.exports = router;
