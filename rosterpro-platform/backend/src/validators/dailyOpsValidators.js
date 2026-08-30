const { z } = require("zod");

const monthKey = z.string().regex(/^\d{4}-\d{2}$/, "Expected month as YYYY-MM");
const monthQuerySchema = z.object({ stationId: z.string().uuid(), monthKey });

const createAdjustmentSchema = z.object({
  stationId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD"),
  description: z.string().min(1).max(500),
  reqB1: z.number().int().min(0).default(0),
  reqB2: z.number().int().min(0).default(0),
  reqCM: z.number().int().min(0).default(0),
  reqNCS: z.number().int().min(0).default(0),
}).transform(v => ({ ...v, date: new Date(v.date) }));

module.exports = { monthQuerySchema, createAdjustmentSchema };
