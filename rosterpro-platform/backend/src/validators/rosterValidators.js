const { z } = require("zod");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD");
const monthKey = z.string().regex(/^\d{4}-\d{2}$/, "Expected month as YYYY-MM");

const createRosterSchema = z.object({
  stationId: z.string().uuid(),
  monthKey: monthKey,
});

const upsertShiftSchema = z.object({
  userId: z.string().uuid(),
  shiftDate: isoDate,
  shiftCode: z.string().min(1).max(10),
  note: z.string().max(500).optional(),
  reason: z.string().max(500).optional(), // shown in the audit trail entry for this change
});

// Bulk variant — e.g. applying a generated roster or a pattern across many
// days/staff in one call instead of one HTTP round-trip per cell.
const bulkUpsertShiftSchema = z.object({
  assignments: z.array(upsertShiftSchema).min(1).max(2000),
});

const publishRosterSchema = z.object({
  rosterId: z.string().uuid(),
});

const unpublishRosterSchema = z.object({
  rosterId: z.string().uuid(),
  reason: z.string().min(1, "A reason is required to unpublish a live roster").max(500),
});

const rosterQuerySchema = z.object({
  stationId: z.string().uuid(),
  monthKey: monthKey,
});

const generateRosterSchema = z.object({
  stationId: z.string().uuid(),
  monthKey: monthKey,
  preview: z.boolean().optional(),
  continueFromPrevious: z.boolean().optional(),
  usePatterns: z.boolean().optional(),
  applyLeave: z.boolean().optional(),
  aogBuffer: z.coerce.number().int().min(0).max(50).optional(),
});

const archiveQuerySchema = z.object({
  stationId: z.string().uuid(),
});

// ─── Shift definition single-row CRUD (Shift Definitions tab) ───────────────
const shiftDefTypes = z.enum(["duty", "night", "off", "leave", "other"]);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM (24-hour)");

const upsertShiftDefSchema = z.object({
  // Only meaningful for SUPER_ADMIN, who has no fixed airlineId of their
  // own (see resolveAirlineId in utils/stationScope.js) — names which
  // tenant's shift definitions to touch. Every other role's actor.airlineId
  // is already authoritative and this is ignored.
  stationId: z.string().uuid().optional(),
  code: z.string().min(1).max(10),
  name: z.string().min(1).max(60),
  startTime: timeStr.optional().nullable(),
  endTime: timeStr.optional().nullable(),
  breakMin: z.number().int().min(0).default(0),
  type: shiftDefTypes,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  sortOrder: z.number().int().optional(),
});

// ─── Shift patterns (Shift Patterns tab) ─────────────────────────────────────
const cyclePattern = z.string().regex(/^[A-Z0-9]+$/, "Cycle must be shift codes only (A-Z, 0-9), no spaces").min(1).max(60);

const upsertShiftPatternSchema = z.object({
  stationId: z.string().uuid(),
  code: z.string().min(1).max(10),
  name: z.string().min(1).max(80),
  cycle: cyclePattern,
});

const patternQuerySchema = z.object({ stationId: z.string().uuid() });

// ─── Staff allocation (Staff Allocation tab) ─────────────────────────────────
const upsertAllocationSchema = z.object({
  userId: z.string().uuid(),
  patternId: z.string().uuid().nullable(),
  cycleStartDay: z.number().int().min(0).max(60).default(0),
});

// ─── Workload input (Workload Input tab) ─────────────────────────────────────
const workloadSections = z.enum(["transit", "nighthalt", "clash", "task"]);

const upsertWorkloadItemSchema = z.object({
  stationId: z.string().uuid(),
  section: workloadSections,
  label: z.string().min(1).max(120),
  count: z.number().int().min(0).default(0),
  b1: z.number().int().min(0).default(0),
  b2: z.number().int().min(0).default(0),
  cm: z.number().int().min(0).default(0),
  ncs: z.number().int().min(0).default(0),
});

const manpowerPlanQuerySchema = z.object({
  stationId: z.string().uuid(),
  monthKey: monthKey,
  aogBuffer: z.coerce.number().int().min(0).max(50).optional(),
});

module.exports = {
  createRosterSchema, upsertShiftSchema, bulkUpsertShiftSchema,
  publishRosterSchema, unpublishRosterSchema, rosterQuerySchema, generateRosterSchema, archiveQuerySchema,
  upsertShiftDefSchema,
  upsertShiftPatternSchema, patternQuerySchema,
  upsertAllocationSchema,
  upsertWorkloadItemSchema, manpowerPlanQuerySchema,
};
