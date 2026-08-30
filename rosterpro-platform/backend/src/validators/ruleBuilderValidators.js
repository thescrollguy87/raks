const { z } = require("zod");

const stationQuerySchema = z.object({ stationId: z.string().uuid() });

const upsertStaffGroupSchema = z.object({
  id: z.string().uuid().optional(),
  stationId: z.string().uuid(),
  name: z.string().min(1).max(80),
  memberUserIds: z.array(z.string().uuid()).default([]),
});

const CONDITION_TYPES = [
  "max_consecutive_nights", "rest_after_night", "min_rest_hours", "forced_off_after_nights",
  "max_weekly_hours", "max_monthly_hours", "night_only", "no_night",
  "balance_total_hours", "balance_night_duties",
];

const upsertRuleSchema = z.object({
  id: z.string().uuid().optional(),
  stationId: z.string().uuid(),
  name: z.string().min(1).max(120),
  appliesToType: z.enum(["all", "category", "group", "staff"]).default("all"),
  appliesToValue: z.string().max(80).optional().nullable(),
  conditionType: z.enum(CONDITION_TYPES),
  limitValue: z.number().int().optional().nullable(),
  offDays: z.number().int().optional().nullable(),
  priority: z.enum(["High", "Medium", "Low"]).default("Medium"),
  type: z.enum(["hard", "soft"]),
  enabled: z.boolean().default(true),
});

module.exports = { stationQuerySchema, upsertStaffGroupSchema, upsertRuleSchema };
