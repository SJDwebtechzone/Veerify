const express = require('express');
const router = express.Router();
const courseController = require('../controllers/course.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Public routes
router.get('/institution/:id', courseController.getCoursesByInstitution);
router.get('/:id', courseController.getCourseById);

// Admin-only routes
router.post('/', verifyToken, requireRole('admin'), courseController.createCourse);
router.get('/', verifyToken, requireRole('admin'), courseController.getMyCourses);
router.put('/:id', verifyToken, requireRole('admin'), courseController.updateCourse);
router.delete('/:id', verifyToken, requireRole('admin'), courseController.deleteCourse);

module.exports = router;