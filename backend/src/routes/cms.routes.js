const express = require('express');
const router = express.Router();
const cms = require('../controllers/cms.controller');

// Each resource shares the same CRUD shape: list / create / update / delete / reorder.
// Endpoints are intentionally unauthenticated for the mock-admin build.
// Lock them down with verifyToken + requireRole once admin auth is wired up.

function mount(prefix, ctrl) {
  router.get(`/${prefix}`, ctrl.list);
  router.post(`/${prefix}`, ctrl.create);
  router.put(`/${prefix}/:id`, ctrl.update);
  router.delete(`/${prefix}/:id`, ctrl.remove);
  router.post(`/${prefix}/reorder`, ctrl.reorder);
}

mount('banners', cms.banners);
mount('categories', cms.categories);
mount('videos', cms.videos);
mount('events', cms.events);

module.exports = router;
