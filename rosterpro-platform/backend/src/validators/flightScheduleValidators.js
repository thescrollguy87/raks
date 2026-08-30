const { z } = require("zod");

const flightScheduleQuerySchema = z.object({
  stationId: z.string().uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

module.exports = { flightScheduleQuerySchema };
