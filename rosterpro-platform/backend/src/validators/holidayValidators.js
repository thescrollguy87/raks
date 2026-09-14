const { z } = require("zod");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD");

const createHolidaySchema = z.object({
  date: isoDate,
  name: z.string().min(1).max(200),
  stationId: z.string().uuid().optional(), // omitted = airline-wide (Airline Admin/Super Admin) or "my own station" (Station Manager)
});

const updateHolidaySchema = z.object({
  date: isoDate.optional(),
  name: z.string().min(1).max(200).optional(),
});

const holidayQuerySchema = z.object({
  stationId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});

module.exports = { createHolidaySchema, updateHolidaySchema, holidayQuerySchema };
