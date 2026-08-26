const { z } = require("zod");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD");

const createFindingSchema = z.object({
  stationId: z.string().uuid(),
  auditRef: z.string().max(100).optional(),
  category: z.string().min(1).max(100),
  severity: z.enum(["minor", "major", "critical"]),
  description: z.string().min(1).max(2000),
  dueDate: isoDate.optional(),
});

const updateFindingSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "CLOSED", "OVERDUE"]).optional(),
  dueDate: isoDate.optional(),
  description: z.string().min(1).max(2000).optional(),
});

const createCapaSchema = z.object({
  findingId: z.string().uuid(),
  ownerId: z.string().uuid(),
  correctiveAction: z.string().min(1).max(2000),
  rootCause: z.string().max(2000).optional(),
  preventiveAction: z.string().max(2000).optional(),
  targetDate: isoDate,
});

const closeCapaSchema = z.object({
  closedDate: isoDate,
  note: z.string().max(1000).optional(),
});

module.exports = { createFindingSchema, updateFindingSchema, createCapaSchema, closeCapaSchema };
