const { z } = require("zod");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD");

// capturedAt is the device's own clock at the moment the button was tapped
// — the whole point of the offline queue is that this can be hours behind
// the server's receipt time, so it's required, not defaulted to "now".
const punchSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).optional(),
  capturedAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  photoBase64: z.string().min(1, "A photo is required to punch"),
});

const attendanceQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  stationId: z.string().uuid().optional(),
  status: z.enum(["ON_TIME", "LATE", "EARLY_OUT", "MISSING", "REGULARIZED", "EXEMPT"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const overviewQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  from: isoDate,
  to: isoDate,
});

module.exports = { punchSchema, attendanceQuerySchema, overviewQuerySchema };
