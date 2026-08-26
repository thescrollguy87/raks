const express = require("express");
const ctrl = require("../controllers/notificationController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");

const router = express.Router();
router.use(requireAuth);

// Anyone can see their own notification history — no special permission
// needed beyond being logged in as that user.
router.get("/me", ctrl.myNotifications);

// Viewing someone else's history is an admin/manager action.
router.get("/:userId", requirePermission("users", "read"), ctrl.notificationsForUser);

module.exports = router;
