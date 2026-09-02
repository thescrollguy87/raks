const express = require("express");
const multer = require("multer");
const ctrl = require("../controllers/rosterController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { requireOwnStation } = require("../utils/stationScope");
const {
  upsertShiftSchema, deleteShiftSchema, bulkUpsertShiftSchema, publishRosterSchema, unpublishRosterSchema, rosterQuerySchema, generateRosterSchema, archiveQuerySchema,
  upsertShiftDefSchema, upsertShiftPatternSchema, patternQuerySchema, upsertAllocationSchema, upsertWorkloadItemSchema, manpowerPlanQuerySchema,
} = require("../validators/rosterValidators");

// Memory storage — the file is parsed in-request (rosterImportService) and
// never needs to touch disk; capped well above any realistic roster export.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();
router.use(requireAuth);

router.get("/shift-definitions", requirePermission("shift", "read"), ctrl.shiftDefinitions);

// Shift definitions are airline-wide (no stationId on the model) — these
// deliberately have no requireOwnStation check, unlike everything else in
// this file.
router.get("/shift-definitions/template", requirePermission("shift", "read"), ctrl.shiftDefinitionsTemplate);
router.get("/shift-definitions/export", requirePermission("shift", "read"), ctrl.shiftDefinitionsExport);
router.post("/shift-definitions/import", requirePermission("roster", "update"), upload.single("file"), ctrl.importShiftDefinitions);
router.put("/shift-definitions", requirePermission("roster", "update"), validate(upsertShiftDefSchema), ctrl.upsertShiftDefinition);
router.delete("/shift-definitions/:id", requirePermission("roster", "update"), ctrl.deactivateShiftDefinition);

// ─── Shift Patterns (Shift Patterns tab) ─────────────────────────────────────
router.get("/patterns", requirePermission("roster", "read"), validateQuery(patternQuerySchema), requireOwnStation("query"), ctrl.listPatterns);
router.put("/patterns", requirePermission("roster", "update"), validate(upsertShiftPatternSchema), requireOwnStation("body"), ctrl.upsertPattern);
router.delete("/patterns/:id", requirePermission("roster", "update"), ctrl.deletePattern);

// ─── Staff Allocation (Staff Allocation tab) ─────────────────────────────────
router.get("/allocations", requirePermission("roster", "read"), validateQuery(patternQuerySchema), requireOwnStation("query"), ctrl.listAllocations);
router.put("/allocations", requirePermission("roster", "update"), validate(upsertAllocationSchema), ctrl.upsertAllocation);

// ─── Workload Input (Workload Input tab) ─────────────────────────────────────
router.get("/workload-items", requirePermission("roster", "read"), validateQuery(patternQuerySchema), requireOwnStation("query"), ctrl.listWorkloadItems);
router.put("/workload-items", requirePermission("roster", "update"), validate(upsertWorkloadItemSchema), requireOwnStation("body"), ctrl.upsertWorkloadItem);
router.delete("/workload-items/:id", requirePermission("roster", "update"), ctrl.deleteWorkloadItem);

// ─── Manpower Plan (Generate tab's "Calculate" step) ─────────────────────────
router.get("/manpower-plan", requirePermission("roster", "read"), validateQuery(manpowerPlanQuerySchema), requireOwnStation("query"), ctrl.manpowerPlan);

router.get("/", requirePermission("roster", "read"), validateQuery(rosterQuerySchema), requireOwnStation("query"), ctrl.getGrid);

router.patch("/shift", requirePermission("shift", "update"), validateQuery(rosterQuerySchema), requireOwnStation("query"), validate(upsertShiftSchema), ctrl.upsertShift);

router.delete("/shift", requirePermission("shift", "update"), validateQuery(rosterQuerySchema), requireOwnStation("query"), validate(deleteShiftSchema), ctrl.deleteShift);

router.post("/shift/bulk", requirePermission("roster", "update"), validateQuery(rosterQuerySchema), requireOwnStation("query"), validate(bulkUpsertShiftSchema), ctrl.bulkUpsertShifts);

router.post("/generate", requirePermission("roster", "update"), validate(generateRosterSchema), requireOwnStation("body"), ctrl.generate);

router.get("/archive", requirePermission("roster", "read"), validateQuery(archiveQuerySchema), requireOwnStation("query"), ctrl.archive);

router.post("/import", requirePermission("roster", "update"), validateQuery(rosterQuerySchema), requireOwnStation("query"), upload.single("file"), ctrl.importRoster);

router.post("/publish", requirePermission("roster", "publish"), validate(publishRosterSchema), ctrl.publish);

router.post("/unpublish", requirePermission("roster", "unpublish"), validate(unpublishRosterSchema), ctrl.unpublish);

module.exports = router;
