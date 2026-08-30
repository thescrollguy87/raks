const express = require("express");
const ctrl = require("../controllers/workloadConfigController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { requireOwnStation } = require("../utils/stationScope");
const {
  stationQuerySchema, manualDemandQuerySchema,
  upsertConfigSchema, upsertMandatoryCoverageRuleSchema,
  upsertPlannedTaskSchema, upsertUnplannedTaskSchema, createManualDemandSchema,
} = require("../validators/workloadConfigValidators");

const router = express.Router();
router.use(requireAuth);

// ─── Standard durations / ratios / buffers ───────────────────────────────────
router.get("/", requirePermission("roster", "read"), validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.getConfig);
router.put("/", requirePermission("roster", "update"), validate(upsertConfigSchema), requireOwnStation("body"), ctrl.upsertConfig);

// ─── Mandatory Minimum Coverage grid ──────────────────────────────────────────
router.get("/mandatory-coverage", requirePermission("roster", "read"), validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.listMandatoryCoverageRules);
router.put("/mandatory-coverage", requirePermission("roster", "update"), validate(upsertMandatoryCoverageRuleSchema), requireOwnStation("body"), ctrl.upsertMandatoryCoverageRule);

// ─── Task Masters ─────────────────────────────────────────────────────────────
router.get("/planned-tasks", requirePermission("roster", "read"), validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.listPlannedTasks);
router.put("/planned-tasks", requirePermission("roster", "update"), validate(upsertPlannedTaskSchema), requireOwnStation("body"), ctrl.upsertPlannedTask);
router.delete("/planned-tasks/:id", requirePermission("roster", "update"), ctrl.deletePlannedTask);

router.get("/unplanned-tasks", requirePermission("roster", "read"), validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.listUnplannedTasks);
router.put("/unplanned-tasks", requirePermission("roster", "update"), validate(upsertUnplannedTaskSchema), requireOwnStation("body"), ctrl.upsertUnplannedTask);
router.delete("/unplanned-tasks/:id", requirePermission("roster", "update"), ctrl.deleteUnplannedTask);

// ─── Manual Additional Demand ─────────────────────────────────────────────────
router.get("/manual-demand", requirePermission("roster", "read"), validateQuery(manualDemandQuerySchema), requireOwnStation("query"), ctrl.listManualDemand);
router.post("/manual-demand", requirePermission("roster", "update"), validate(createManualDemandSchema), requireOwnStation("body"), ctrl.createManualDemand);
router.delete("/manual-demand/:id", requirePermission("roster", "update"), ctrl.deleteManualDemand);

module.exports = router;
