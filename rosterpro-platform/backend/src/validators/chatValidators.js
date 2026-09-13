const { z } = require("zod");

const askSchema = z.object({
  stationId: z.string().uuid(),
  question: z.string().min(1).max(1000),
});

const logQuerySchema = z.object({
  stationId: z.string().uuid().optional(),
  from: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  to: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

module.exports = { askSchema, logQuerySchema };
