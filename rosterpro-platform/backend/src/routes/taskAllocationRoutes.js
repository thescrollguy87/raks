// TASK ALLOCATION MODULE — mounted at /api/task-allocation (see
// src/routes/index.js, the ONLY line touched in that existing file). Every
// route here is new; nothing under /api/roster, /api/users, etc. changes.
//
// Section 2 / Section 26: gated end-to-end by TASK_ALLOCATION_ENABLED
// (requireFeatureEnabled, below) AND its own permission set — a user who
// can view the Roster does NOT automatically get any Task Allocation
// permission; these are separate resource:action keys
// (task_allocation:view/create/assign/reallocate/override/settings/admin)
// seeded independently in prisma/seed.js, granted to no role by default.
const express = require("express");
const { z } = require("zod");
const ctrl = require("../controllers/taskAllocationController");
const env = require("../config/env");
const ApiError = require("../utils/ApiError");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { requireOwnStation } = require("../utils/stationScope");
const {
  flightInstanceSchema, flightInstanceBulkSchema,
  allocationRuleSchema, allocationSettingsSchema, travelTimeSchema,
  taskQuerySchema, generateTasksSchema, createTaskSchema, cancelTaskSchema,
  autoAllocateSchema, manualAssignSchema, reallocateSchema, whatIfSchema, commitWhatIfSchema,
  conflictsQuerySchema, historyQuerySchema, stationQuerySchema, dateRangeQuerySchema, detectConflictsSchema,
} = require("../validators/taskAllocationValidators");

function requireFeatureEnabled(req, res, next) {
  if (!env.taskAllocationEnabled) return next(ApiError.notFound("Task Allocation is not enabled"));
  next();
}

const router = express.Router();

// Public — the frontend checks this BEFORE even showing the nav item, with
// no auth required, so a disabled module never prompts an unauthenticated
// user to log in just to find out it's off.
router.get("/enabled", ctrl.enabled);

router.use(requireAuth, requireFeatureEnabled);
const view = requirePermission("task_allocation", "view");
const create = requirePermission("task_allocation", "create");
const assign = requirePermission("task_allocation", "assign");
const reallocatePerm = requirePermission("task_allocation", "reallocate");
const overridePerm = requirePermission("task_allocation", "override");
const settingsPerm = requirePermission("task_allocation", "settings");

// ─── Section 6: roster sync / availability ───────────────────────────────────
router.get("/roster-sync-status", view, validateQuery(stationQuerySchema.extend({ date: z.coerce.date() })), requireOwnStation("query"), ctrl.rosterSyncStatus);
router.get("/availability", view, validateQuery(stationQuerySchema.extend({ date: z.coerce.date() })), requireOwnStation("query"), ctrl.availabilitySummary);

// ─── Flight Instances ─────────────────────────────────────────────────────────
router.get("/flight-instances", view, validateQuery(dateRangeQuerySchema), requireOwnStation("query"), ctrl.listFlightInstances);
router.put("/flight-instances", create, validate(flightInstanceSchema), requireOwnStation("body"), ctrl.upsertFlightInstance);
router.delete("/flight-instances/:id", create, ctrl.deleteFlightInstance);
router.post("/flight-instances/replace-day", create, validate(flightInstanceBulkSchema), requireOwnStation("body"), ctrl.replaceFlightInstances);

// ─── Allocation Rules (Task Generator config) ────────────────────────────────
router.get("/rules", settingsPerm, validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.listRules);
router.put("/rules", settingsPerm, validate(allocationRuleSchema), requireOwnStation("body"), ctrl.upsertRule);
router.delete("/rules/:id", settingsPerm, ctrl.deleteRule);

// ─── Settings (optimizer weights, refresh cadence) ───────────────────────────
router.get("/settings", view, validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.getSettings);
router.patch("/settings", settingsPerm, validateQuery(stationQuerySchema), requireOwnStation("query"), validate(allocationSettingsSchema), ctrl.updateSettings);

// ─── Travel Time Matrix ───────────────────────────────────────────────────────
router.get("/travel-time", view, validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.listTravelTimes);
router.put("/travel-time", settingsPerm, validate(travelTimeSchema), requireOwnStation("body"), ctrl.upsertTravelTime);
router.delete("/travel-time/:id", settingsPerm, ctrl.deleteTravelTime);

// ─── Task Generator ───────────────────────────────────────────────────────────
router.post("/generate", create, validate(generateTasksSchema), requireOwnStation("body"), ctrl.generateTasks);

// ─── Tasks / Task Board ───────────────────────────────────────────────────────
router.get("/tasks", view, validateQuery(taskQuerySchema), requireOwnStation("query"), ctrl.listTasks);
router.get("/tasks/:id", view, validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.getTask);
router.post("/tasks", create, validate(createTaskSchema), requireOwnStation("body"), ctrl.createTask);
router.post("/tasks/:id/cancel", create, validate(cancelTaskSchema), requireOwnStation("body"), ctrl.cancelTask);

// ─── Unassigned Tasks ─────────────────────────────────────────────────────────
router.get("/unassigned", view, validateQuery(dateRangeQuerySchema), requireOwnStation("query"), ctrl.listUnassigned);
router.get("/unassigned/:id/explain", view, validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.explainUnassigned);

// ─── Candidates / Eligibility ─────────────────────────────────────────────────
router.get("/candidates/:taskId", view, validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.getCandidates);

// ─── Allocation / Manual / Reallocation / What-If ────────────────────────────
router.post("/allocate", assign, validate(autoAllocateSchema), requireOwnStation("body"), ctrl.allocate);
router.post("/manual-assignment", assign, validate(manualAssignSchema), requireOwnStation("body"), (req, res, next) => {
  // An ineligible-candidate override additionally requires its own
  // dedicated permission (Section 18/26) — holding plain "assign" alone is
  // never enough to knowingly bypass a hard constraint.
  if (req.body.override && !(req.user.roles?.includes("SUPER_ADMIN") || req.user.permissions?.includes("task_allocation:override"))) {
    return next(ApiError.forbidden("Missing permission: task_allocation:override"));
  }
  next();
}, ctrl.manualAssignment);
router.post("/reallocate", reallocatePerm, validate(reallocateSchema), requireOwnStation("body"), ctrl.reallocate);
router.post("/what-if", view, validate(whatIfSchema), requireOwnStation("body"), ctrl.whatIf); // simulation only, never commits — view is enough
router.post("/what-if/commit", reallocatePerm, validate(commitWhatIfSchema), requireOwnStation("body"), ctrl.commitWhatIf);

// ─── Conflicts ────────────────────────────────────────────────────────────────
router.get("/conflicts", view, validateQuery(conflictsQuerySchema), requireOwnStation("query"), ctrl.listConflicts);
router.post("/conflicts/detect", view, validate(detectConflictsSchema), requireOwnStation("body"), ctrl.detectConflicts);

// ─── Allocation History ───────────────────────────────────────────────────────
router.get("/history", view, validateQuery(historyQuerySchema), requireOwnStation("query"), ctrl.history);
router.get("/runs", view, validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.listRuns);
router.get("/runs/:id", view, validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.getRun);

module.exports = router;
