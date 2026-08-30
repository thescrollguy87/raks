const { z } = require("zod");

const stationQuerySchema = z.object({ stationId: z.string().uuid() });
const monthKey = z.string().regex(/^\d{4}-\d{2}$/, "Expected month as YYYY-MM");
const manualDemandQuerySchema = z.object({ stationId: z.string().uuid(), monthKey });

const upsertConfigSchema = z.object({
  stationId: z.string().uuid(),
  transitMinutesDefault: z.number().int().min(0).max(600).optional(),
  pdcMinutesBeforeDeparture: z.number().int().min(0).max(600).optional(),
  clashProximityMinutes: z.number().int().min(0).max(600).optional(),
  transitVsPdcThresholdMinutes: z.number().int().min(0).max(600).optional(),
  movementsPerB1Staff: z.number().int().min(1).max(50).optional(),
  movementsPerCMStaff: z.number().int().min(1).max(50).optional(),
  movementsPerNCSStaff: z.number().int().min(1).max(50).optional(),
  unplannedMethod: z.enum(["frequency", "manpower_hours", "both"]).optional(),
  unplannedManpowerHoursPerMonth: z.number().int().min(0).optional(),
  unplannedBufferPct: z.number().int().min(0).max(200).optional(),
  bufferB1: z.number().int().min(0).max(50).optional(),
  bufferB2: z.number().int().min(0).max(50).optional(),
  bufferCM: z.number().int().min(0).max(50).optional(),
  bufferNCS: z.number().int().min(0).max(50).optional(),
});

const upsertMandatoryCoverageRuleSchema = z.object({
  stationId: z.string().uuid(),
  category: z.enum(["B1", "B2", "CM"]),
  shift: z.enum(["M", "A", "N"]),
  enabled: z.boolean(),
  minCount: z.number().int().min(1).max(50).default(1),
});

const taskFields = {
  stationId: z.string().uuid(),
  name: z.string().min(1).max(120),
  avgDurationMin: z.number().int().min(0).max(1440).default(0),
  reqB1: z.number().int().min(0).default(0),
  reqB2: z.number().int().min(0).default(0),
  reqCM: z.number().int().min(0).default(0),
  reqNCS: z.number().int().min(0).default(0),
  preferredShift: z.enum(["M", "A", "N", "Any"]).nullable().optional(),
  nightApplicable: z.boolean().default(false),
  remarks: z.string().max(500).optional().nullable(),
  sortOrder: z.number().int().default(0),
};

const upsertPlannedTaskSchema = z.object({
  id: z.string().uuid().optional(),
  ...taskFields,
  frequency: z.number().int().min(0).default(0),
  frequencyUnit: z.enum(["per_month", "per_week", "per_operating_day"]).default("per_month"),
});

const upsertUnplannedTaskSchema = z.object({
  id: z.string().uuid().optional(),
  ...taskFields,
  avgFreqPerMonth: z.number().int().min(0).default(0),
});

const createManualDemandSchema = z.object({
  stationId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD"),
  timeStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
  timeEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
  reqB1: z.number().int().min(0).default(0),
  reqB2: z.number().int().min(0).default(0),
  reqCM: z.number().int().min(0).default(0),
  reqNCS: z.number().int().min(0).default(0),
  remarks: z.string().max(500).optional().nullable(),
}).transform(v => ({ ...v, date: new Date(v.date) }));

module.exports = {
  stationQuerySchema, manualDemandQuerySchema,
  upsertConfigSchema, upsertMandatoryCoverageRuleSchema,
  upsertPlannedTaskSchema, upsertUnplannedTaskSchema, createManualDemandSchema,
};
