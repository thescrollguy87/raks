const express = require("express");
const ctrl = require("../controllers/toolController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { createToolSchema, calibrateToolSchema, issueToolSchema, returnToolSchema } = require("../validators/toolValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/due-for-calibration", requirePermission("tool", "read"), ctrl.dueForCalibration);
router.get("/station/:stationId", requirePermission("tool", "read"), ctrl.listForStation);
router.post("/", requirePermission("tool", "calibrate"), validate(createToolSchema), ctrl.create);
router.post("/:id/calibrate", requirePermission("tool", "calibrate"), validate(calibrateToolSchema), ctrl.calibrate);
router.post("/:id/issue", requirePermission("tool", "issue"), validate(issueToolSchema), ctrl.issue);
router.post("/return", requirePermission("tool", "return"), validate(returnToolSchema), ctrl.returnTool);

module.exports = router;
