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
});

const archiveQuerySchema = z.object({
  stationId: z.string().uuid(),
});

module.exports = {
  createRosterSchema, upsertShiftSchema, bulkUpsertShiftSchema,
  publishRosterSchema, unpublishRosterSchema, rosterQuerySchema, generateRosterSchema, archiveQuerySchema,
};
