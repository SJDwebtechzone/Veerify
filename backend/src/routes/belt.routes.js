const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/belt.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Anyone authenticated can read the institution's belt sequence (used by
// the journey screen for students/parents and the promote dropdown for
// trainers/admins).
router.get('/levels', verifyToken, ctrl.getLevels);

// Student / parent / staff / admin can pull a journey, with auth checked
// inside the controller against the studentId.
router.get('/my-journey',          verifyToken, requireRole('student'), ctrl.myJourney);
router.get('/journey/:studentId',  verifyToken, ctrl.getJourney);

// Trainer / admin promote a student.
router.post('/promote', verifyToken, requireRole('trainer', 'admin'), ctrl.promote);

module.exports = router;
