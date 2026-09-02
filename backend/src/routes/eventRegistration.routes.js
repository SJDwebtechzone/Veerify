// src/routes/eventRegistration.routes.js
//
// MODULE 2: Event → Select Students for Registration.
//   GET /api/events/:eventId/eligible-students   → paginated list
//   GET /api/events/:eventId/registration-check  → duplicate probe

const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/eventRegistration.controller');

router.get('/events/:eventId/eligible-students',
  verifyToken, ctrl.listEligibleStudents);

router.get('/events/:eventId/registration-check',
  verifyToken, ctrl.checkAlreadyRegistered);

// MODULE 3: profile snapshots for auto-populate + final submission.
router.get('/events/:eventId/students-profile',
  verifyToken, ctrl.getStudentSnapshots);

router.post('/events/:eventId/register',
  verifyToken, ctrl.submitRegistration);

module.exports = router;
