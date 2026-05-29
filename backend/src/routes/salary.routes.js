const express = require('express');
const router = express.Router();
const salary = require('../controllers/salary.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Trainer reads own.
router.get('/me',        verifyToken, requireRole('trainer'), salary.getMySalaries);
router.get('/me/:id',    verifyToken, requireRole('trainer'), salary.getMySalaryById);

// Admin manages.
router.get('/',          verifyToken, requireRole('admin'),   salary.listForInstitution);
router.post('/',         verifyToken, requireRole('admin'),   salary.create);
router.put('/:id',       verifyToken, requireRole('admin'),   salary.update);
router.post('/:id/mark-paid', verifyToken, requireRole('admin'), salary.markPaid);

module.exports = router;
