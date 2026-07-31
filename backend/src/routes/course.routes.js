const express = require('express');
const router = express.Router();
const courseController = require('../controllers/course.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireActiveSubscription } = require('../utils/subscriptionGuard');

// Public routes
router.get('/institution/:id', courseController.getCoursesByInstitution);
router.get('/:id', courseController.getCourseById);

// Admin-only routes. Every write path (create / update / delete)
// is gated behind requireActiveSubscription per the expired-plan
// spec — only reads stay open so the admin can still see their
// data before deciding to renew.
router.post('/', verifyToken, requireRole('admin'), requireActiveSubscription, courseController.createCourse);
router.get('/', verifyToken, requireRole('admin'), courseController.getMyCourses);
router.put('/:id', verifyToken, requireRole('admin'), requireActiveSubscription, courseController.updateCourse);
router.delete('/:id', verifyToken, requireRole('admin'), requireActiveSubscription, courseController.deleteCourse);

module.exports = router;