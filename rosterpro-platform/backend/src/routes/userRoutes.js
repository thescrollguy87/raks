const express = require("express");
const ctrl = require("../controllers/userController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");

const router = express.Router();

router.get("/", requireAuth, requirePermission("users", "read"), ctrl.list);

module.exports = router;
