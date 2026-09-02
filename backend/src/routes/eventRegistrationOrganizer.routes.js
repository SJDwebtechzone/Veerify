// src/routes/eventRegistrationOrganizer.routes.js
//
// MODULE 4: Organizer Registration Management routes. Every one is
// scoped to the organizing institution inside the controller.

const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/eventRegistrationOrganizer.controller');

router.get('/events/:eventId/registrations/summary',
  verifyToken, ctrl.getSummary);

router.get('/events/:eventId/registrations/institutions',
  verifyToken, ctrl.listInstitutions);

// Institution-wise Excel export. Kept above /registrations/:regId
// so the literal path `export.xlsx` doesn't get captured by the
// dynamic :regId route.
router.get('/events/:eventId/registrations/export.xlsx',
  verifyToken, ctrl.exportRegistrationsXlsx);

router.get('/events/:eventId/registrations',
  verifyToken, ctrl.listRegistrations);

router.get('/events/:eventId/registrations/:regId',
  verifyToken, ctrl.getRegistrationDetail);

router.patch('/events/:eventId/registrations/:regId/status',
  verifyToken, ctrl.updateStatus);

module.exports = router;
