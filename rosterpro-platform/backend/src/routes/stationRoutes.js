const express = require("express");
const ctrl = require("../controllers/stationController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");

const router = express.Router();
router.get("/", requireAuth, requirePermission("station", "read"), ctrl.list);

module.exports = router;
