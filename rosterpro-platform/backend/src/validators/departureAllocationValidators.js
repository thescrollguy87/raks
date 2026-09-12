const { z } = require("zod");

const dayQuerySchema = z.object({
  stationId: z.string().uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  day: z.coerce.number().int().min(1).max(31),
});

const manualAssignSchema = z.object({
  stationId: z.string().uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  day: z.coerce.number().int().min(1).max(31),
  eventType: z.enum(["turn", "charter"]),
  eventId: z.string().min(1),
  flightRef: z.string().min(1),
  releaserUserId: z.string().uuid().nullable().optional(),
  releaserCategory: z.enum(["B1", "CM"]).nullable().optional(),
  supportUserId: z.string().uuid().nullable().optional(),
});

module.exports = { dayQuerySchema, manualAssignSchema };
