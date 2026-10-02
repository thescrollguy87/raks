// TASK ALLOCATION MODULE — its own validator file, separate from every
// existing *Validators.js file, under the module's own /api/task-allocation
// namespace only.
const { z } = require("zod");

const isoDate = z.coerce.date();
const stationQuerySchema = z.object({ stationId: z.string().uuid() });
const dateRangeQuerySchema = z.object({ stationId: z.string().uuid(), dateFrom: isoDate, dateTo: isoDate });

const STAFF_CATEGORIES = ["B1", "B2", "CM", "NCS", "STO"];
const TASK_STATUSES = ["DRAFT", "READY", "UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "BLOCKED"];
const TRIGGERS = [
  "MANUAL", "INITIAL_AUTO_ALLOCATION", "FLIGHT_DELAY", "FLIGHT_CANCELLATION", "AIRCRAFT_SWAP", "NEW_DEFECT",
  "TASK_OVERRUN", "STAFF_ABSENCE", "STAFF_UNAVAILABLE", "NEW_TASK", "TASK_CANCELLATION", "STAND_CHANGE", "OPERATIONAL_DISRUPTION",
];

// ─── Flight Instances ─────────────────────────────────────────────────────────
const flightInstanceSchema = z.object({
  id: z.string().uuid().optional(),
  stationId: z.string().uuid(),
  flightDate: isoDate,
  flightNumber: z.string().min(1).max(20),
  aircraftRegistration: z.string().min(1).max(20),
  aircraftType: z.string().max(40).optional(),
  std: isoDate.optional().nullable(),
  sta: isoDate.optional().nullable(),
  etd: isoDate.optional().nullable(),
  eta: isoDate.optional().nullable(),
  stand: z.string().max(20).optional().nullable(),
  terminal: z.string().max(20).optional().nullable(),
  isTransit: z.boolean().optional(),
  remark: z.string().max(500).optional().nullable(),
});
const flightInstanceBulkSchema = z.object({
  stationId: z.string().uuid(),
  flightDate: isoDate,
  rows: z.array(flightInstanceSchema.omit({ id: true, stationId: true, flightDate: true })).min(1).max(500),
});
const flightInstanceSyncSchema = z.object({ stationId: z.string().uuid(), flightDate: isoDate });

// ─── Allocation Rules ─────────────────────────────────────────────────────────
const allocationRuleSchema = z.object({
  id: z.string().uuid().optional(),
  stationId: z.string().uuid(),
  ruleName: z.string().min(1).max(100),
  taskType: z.string().min(1).max(40),
  appliesTo: z.enum(["ARRIVAL", "DEPARTURE", "BOTH"]).default("BOTH"),
  onlyTransit: z.boolean().optional(),
  startOffsetMin: z.number().int(),
  latestStartOffsetMin: z.number().int(),
  deadlineOffsetMin: z.number().int(),
  durationMin: z.number().int().min(1),
  requiredRole: z.string().max(60).optional().nullable(),
  requiredCategory: z.enum(STAFF_CATEGORIES).optional().nullable(),
  requiredAircraftType: z.string().max(40).optional().nullable(),
  requiredAuthorization: z.string().max(60).optional().nullable(),
  teamSize: z.number().int().min(1).default(1),
  priority: z.number().int().min(1).max(5).default(3),
  taskDescription: z.string().max(300).optional().nullable(),
  isEnabled: z.boolean().optional(),
});

// ─── Allocation Settings ──────────────────────────────────────────────────────
const allocationSettingsSchema = z.object({
  weightDeadline: z.number().min(0).max(100).optional(),
  weightWorkloadBalance: z.number().min(0).max(100).optional(),
  weightTravelTime: z.number().min(0).max(100).optional(),
  weightTaskContinuity: z.number().min(0).max(100).optional(),
  weightResourceUtilization: z.number().min(0).max(100).optional(),
  weightIdleTimeReduction: z.number().min(0).max(100).optional(),
  weightFairness: z.number().min(0).max(100).optional(),
  autoRefreshSeconds: z.number().int().min(10).max(3600).optional(),
});

// ─── Travel Time Matrix ───────────────────────────────────────────────────────
const travelTimeSchema = z.object({
  stationId: z.string().uuid(),
  fromLocation: z.string().min(1).max(40),
  toLocation: z.string().min(1).max(40),
  minutes: z.number().int().min(0).max(240),
});

// ─── Tasks ────────────────────────────────────────────────────────────────────
const taskQuerySchema = z.object({
  stationId: z.string().uuid(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  taskType: z.string().optional(),
  aircraftRegistration: z.string().optional(),
  requiredCategory: z.enum(STAFF_CATEGORIES).optional(),
  userId: z.string().uuid().optional(),
});
const generateTasksSchema = z.object({ stationId: z.string().uuid(), date: isoDate });
const createTaskSchema = z.object({
  stationId: z.string().uuid(),
  flightInstanceId: z.string().uuid().optional().nullable(),
  flightNumber: z.string().max(20).optional().nullable(),
  aircraftRegistration: z.string().max(20).optional().nullable(),
  aircraftType: z.string().max(40).optional().nullable(),
  taskType: z.string().min(1).max(40),
  taskCategory: z.string().max(40).optional().nullable(),
  taskDescription: z.string().max(300).optional().nullable(),
  plannedStart: isoDate,
  latestStart: isoDate,
  deadline: isoDate,
  estimatedDurationMin: z.number().int().min(1),
  requiredRole: z.string().max(60).optional().nullable(),
  requiredCategory: z.enum(STAFF_CATEGORIES).optional().nullable(),
  requiredAircraftType: z.string().max(40).optional().nullable(),
  requiredAuthorization: z.string().max(60).optional().nullable(),
  location: z.string().max(40).optional().nullable(),
  terminal: z.string().max(20).optional().nullable(),
  stand: z.string().max(20).optional().nullable(),
  priority: z.number().int().min(1).max(5).default(3),
  teamSize: z.number().int().min(1).default(1),
  status: z.enum(TASK_STATUSES).default("UNASSIGNED"),
});
const cancelTaskSchema = z.object({ stationId: z.string().uuid(), reason: z.string().max(300).optional() });
const detectConflictsSchema = z.object({ stationId: z.string().uuid(), dateFrom: isoDate, dateTo: isoDate });

// ─── Allocation / Manual / Reallocation / What-If ────────────────────────────
const autoAllocateSchema = z.object({
  stationId: z.string().uuid(), dateFrom: isoDate, dateTo: isoDate, taskSource: z.enum(["AUTO_GENERATED", "MANUAL"]).optional(),
});
const manualAssignSchema = z.object({
  stationId: z.string().uuid(), taskId: z.string().uuid(), userId: z.string().uuid(),
  override: z.boolean().optional(), overrideReason: z.string().max(300).optional(),
});
const reallocateSchema = z.object({
  stationId: z.string().uuid(), taskId: z.string().uuid(), trigger: z.enum(TRIGGERS).default("MANUAL"), triggerDetail: z.string().max(300).optional(),
});
const whatIfSchema = z.object({
  stationId: z.string().uuid(), userId: z.string().uuid(), date: isoDate, reason: z.string().max(300).optional(),
});
const commitWhatIfSchema = z.object({ stationId: z.string().uuid(), runId: z.string().uuid() });

// ─── Conflicts / History ──────────────────────────────────────────────────────
const conflictsQuerySchema = z.object({
  stationId: z.string().uuid(), resolved: z.coerce.boolean().optional(), dateFrom: isoDate.optional(), dateTo: isoDate.optional(),
});
const historyQuerySchema = z.object({
  stationId: z.string().uuid(), dateFrom: isoDate.optional(), dateTo: isoDate.optional(), taskId: z.string().uuid().optional(),
});

module.exports = {
  stationQuerySchema, dateRangeQuerySchema,
  flightInstanceSchema, flightInstanceBulkSchema, flightInstanceSyncSchema,
  allocationRuleSchema, allocationSettingsSchema, travelTimeSchema,
  taskQuerySchema, generateTasksSchema, createTaskSchema, cancelTaskSchema, detectConflictsSchema,
  autoAllocateSchema, manualAssignSchema, reallocateSchema, whatIfSchema, commitWhatIfSchema,
  conflictsQuerySchema, historyQuerySchema,
};
