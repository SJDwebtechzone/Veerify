// backend/src/routes/academy.routes.js
//
// Public student-facing "find academies" endpoints. Mounted at
// /api/academies. No JWT — guests can browse nearby academies before
// they sign up.

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/academy.controller');

router.get('/nearby',         ctrl.getNearby);
router.get('/pincode-lookup', ctrl.lookupPincode);

module.exports = router;
