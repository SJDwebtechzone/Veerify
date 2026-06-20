const express = require('express');
const router = express.Router();

const studentController = require('../controllers/student.controller');
const { verifyToken } = require('../middleware/auth.middleware');

const { requireRole } = require('../middleware/role.middleware');

// Super admin - platform-wide students roster. Matches the same pattern as
// /api/trainers/all (JWT only, no role gate; the admin web app's login
// scopes who can call it).
router.get('/all', verifyToken, studentController.getAllStudents);

// Student mobile - recorded videos for batches the caller is paid-enrolled in.
router.get('/my-videos', verifyToken, requireRole('student'), studentController.getMyVideos);

// Student mobile - the calling student's own profile (name + photo_url
// from student_profiles). Used by the home header to render the avatar.
router.get('/me', verifyToken, requireRole('student'), studentController.getMe);

module.exports = router;
