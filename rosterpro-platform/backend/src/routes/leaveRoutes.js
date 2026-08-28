const express = require("express");
const ctrl = require("../controllers/leaveController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission, requireAnyPermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { requestLeaveSchema, decideLeaveSchema, leaveQuerySchema } = require("../validators/leaveValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/", requirePermission("leave", "read"), validateQuery(leaveQuerySchema), ctrl.list);
router.get("/balance/:userId?", requirePermission("leave", "read"), ctrl.balance);
router.post("/", requirePermission("leave", "request"), validate(requestLeaveSchema), ctrl.request);
router.post("/:id/decide", requireAnyPermission(["leave", "approve"], ["leave", "approve_reports"]), validate(decideLeaveSchema), ctrl.decide);
router.post("/:id/cancel", requirePermission("leave", "request"), ctrl.cancel);

module.exports = router;
