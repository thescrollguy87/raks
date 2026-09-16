const express = require("express");
const ctrl = require("../controllers/regularizationController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission, requireAnyPermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { createRegularizationSchema, decideRegularizationSchema, regularizationQuerySchema } = require("../validators/regularizationValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/", requirePermission("attendance", "read"), validateQuery(regularizationQuerySchema), ctrl.list);
router.post("/", requirePermission("regularization", "request"), validate(createRegularizationSchema), ctrl.create);
router.post(
  "/:id/decide",
  requireAnyPermission(["regularization", "approve"], ["regularization", "approve_reports"]),
  validate(decideRegularizationSchema),
  ctrl.decide
);
router.post("/:id/cancel", requirePermission("regularization", "request"), ctrl.cancel);

module.exports = router;
