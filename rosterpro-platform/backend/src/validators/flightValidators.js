const { z } = require("zod");

const isoDateTime = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/));

// airlineId is deliberately not accepted here — flightService.createFlight
// derives it server-side from the target station's real airlineId, never
// from client input (see the comment there for why).
const createFlightSchema = z.object({
  stationId: z.string().uuid(),
  aircraftId: z.string().uuid().optional(),
  flightNumber: z.string().min(1).max(20),
  scheduledIn: isoDateTime.optional(),
  scheduledOut: isoDateTime.optional(),
});

const updateFlightStatusSchema = z.object({
  status: z.enum(["SCHEDULED", "ARRIVED", "DEPARTED", "DELAYED", "CANCELLED"]),
  actualIn: isoDateTime.optional(),
  actualOut: isoDateTime.optional(),
});

const createDelaySchema = z.object({
  flightId: z.string().uuid(),
  delayCode: z.string().min(1).max(20),
  minutes: z.coerce.number().int().positive(),
  ataChapter: z.string().max(20).optional(),
  description: z.string().min(1).max(1000),
  rectification: z.string().max(1000).optional(),
});

const importFlightQuerySchema = z.object({
  stationId: z.string().uuid(),
  monthKey: z.string().regex(/^\d{4}-\d{2}$/, "Expected month as YYYY-MM"),
});

module.exports = { createFlightSchema, updateFlightStatusSchema, createDelaySchema, importFlightQuerySchema };
