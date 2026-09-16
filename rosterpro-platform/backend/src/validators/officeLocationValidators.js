const { z } = require("zod");

const createOfficeLocationSchema = z.object({
  stationId: z.string().uuid(),
  name: z.string().min(1).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(20).max(5000).optional(), // 20m floor filters out fat-finger near-zero radii; 5km ceiling keeps this a "location", not "the whole city"
});

const updateOfficeLocationSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusMeters: z.number().int().min(20).max(5000).optional(),
  isActive: z.boolean().optional(),
});

const officeLocationQuerySchema = z.object({
  stationId: z.string().uuid().optional(),
});

module.exports = { createOfficeLocationSchema, updateOfficeLocationSchema, officeLocationQuerySchema };
