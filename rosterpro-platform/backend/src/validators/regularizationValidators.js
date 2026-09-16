const { z } = require("zod");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD");

const REASONS = ["FORGOT_TO_PUNCH", "FLIGHT_DUTY", "DEPUTATION", "NETWORK_ISSUE", "OTHER"];

const createRegularizationSchema = z.object({
  userId: z.string().uuid().optional(), // omitted = for yourself; set by an L1 Manager filing on a direct report's behalf
  date: isoDate,
  reason: z.enum(REASONS),
  detail: z.string().max(500).optional(),
});

const decideRegularizationSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().max(500).optional(),
}).refine(
  d => d.decision !== "REJECTED" || (d.reason && d.reason.trim().length > 0),
  { message: "A comment is required when rejecting a regularization request", path: ["reason"] }
);

const regularizationQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  stationId: z.string().uuid().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

module.exports = { createRegularizationSchema, decideRegularizationSchema, regularizationQuerySchema, REASONS };
