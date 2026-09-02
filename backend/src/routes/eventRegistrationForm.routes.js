// src/routes/eventRegistrationForm.routes.js
//
// MODULE 1: Registration-form builder routes.
//   GET  /api/events/:eventId/registration-form
//   PUT  /api/events/:eventId/registration-form
//   GET  /api/config/registration-form   (catalog / type list)

const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/eventRegistrationForm.controller');

router.get('/config/registration-form',
  verifyToken, ctrl.getConfig);

router.get('/events/:eventId/registration-form',
  verifyToken, ctrl.getForm);

router.put('/events/:eventId/registration-form',
  verifyToken, ctrl.putForm);

module.exports = router;
