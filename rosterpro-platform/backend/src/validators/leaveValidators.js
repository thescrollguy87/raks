const { z } = require("zod");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD");

const LEAVE_TYPES = ["ANNUAL", "SICK", "CASUAL", "MEDICAL", "LWP", "TRAINING", "OTHER"];

const requestLeaveSchema = z.object({
  userId: z.string().uuid().optional(), // omitted = requesting for yourself; set by a manager requesting on someone's behalf
  leaveType: z.enum(LEAVE_TYPES),
  fromDate: isoDate,
  toDate: isoDate,
  reason: z.string().max(500).optional(),
}).refine(d => d.fromDate <= d.toDate, { message: "fromDate must be on or before toDate", path: ["toDate"] });

const decideLeaveSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().max(500).optional(),
});

const leaveQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  stationId: z.string().uuid().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

module.exports = { requestLeaveSchema, decideLeaveSchema, leaveQuerySchema, LEAVE_TYPES };
