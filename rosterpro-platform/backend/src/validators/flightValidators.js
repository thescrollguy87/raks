const { z } = require("zod");

const isoDateTime = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/));

const createFlightSchema = z.object({
  airlineId: z.string().uuid(),
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

module.exports = { createFlightSchema, updateFlightStatusSchema, createDelaySchema };
