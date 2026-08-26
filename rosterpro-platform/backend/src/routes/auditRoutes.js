const express = require("express");
const ctrl = require("../controllers/auditController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validateQuery } = require("../middleware/validate");
const { auditTrailQuerySchema, activityQuerySchema } = require("../validators/auditValidators");

const router = express.Router();
router.use(requireAuth, requirePermission("audit_trail", "read"));

router.get("/activity", validateQuery(activityQuerySchema), ctrl.listActivity);
router.get("/trail", validateQuery(auditTrailQuerySchema), ctrl.listAuditTrail);
router.get("/trail/:entityType/:entityId", ctrl.entityHistory);

module.exports = router;
