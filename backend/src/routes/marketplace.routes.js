const express = require('express');
const router = express.Router();
const marketplaceController = require('../controllers/marketplace.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// GET marketplace settings — accessible by both super_admin and institution admins
router.get('/', verifyToken, requireRole('super_admin', 'admin'), marketplaceController.getMarketplaceSettings);

// PUT marketplace settings — only accessible by super_admin
router.put('/', verifyToken, requireRole('super_admin'), marketplaceController.updateMarketplaceSettings);

module.exports = router;
