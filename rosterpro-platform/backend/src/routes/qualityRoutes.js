const express = require("express");
const ctrl = require("../controllers/qualityController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { createFindingSchema, updateFindingSchema, createCapaSchema, closeCapaSchema } = require("../validators/qualityValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/overdue", requirePermission("capa", "read"), ctrl.overdue);
router.get("/findings/station/:stationId", requirePermission("audit_finding", "read"), ctrl.listFindings);
router.post("/findings", requirePermission("audit_finding", "create"), validate(createFindingSchema), ctrl.raiseFinding);
router.patch("/findings/:id", requirePermission("audit_finding", "update"), validate(updateFindingSchema), ctrl.updateFinding);

router.get("/capas/owner/:ownerId", requirePermission("capa", "read"), ctrl.listCapasForOwner);
router.post("/capas", requirePermission("capa", "create"), validate(createCapaSchema), ctrl.openCapa);
router.post("/capas/:id/close", requirePermission("capa", "close"), validate(closeCapaSchema), ctrl.closeCapa);

module.exports = router;
