const { z } = require("zod");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD");

const createToolSchema = z.object({
  stationId: z.string().uuid(),
  toolNo: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  calibrationDue: isoDate.optional(),
});

const calibrateToolSchema = z.object({
  calibratedOn: isoDate,
  nextDue: isoDate,
  certificateNo: z.string().max(100).optional(),
  attachmentId: z.string().uuid().optional(),
});

const issueToolSchema = z.object({
  issuedToId: z.string().uuid(),
  workOrderRef: z.string().max(100).optional(),
});

const returnToolSchema = z.object({
  issueId: z.string().uuid(),
});

module.exports = { createToolSchema, calibrateToolSchema, issueToolSchema, returnToolSchema };
