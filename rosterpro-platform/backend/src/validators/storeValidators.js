const { z } = require("zod");

const createStoreItemSchema = z.object({
  stationId: z.string().uuid(),
  partNo: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  quantityOnHand: z.coerce.number().int().min(0).default(0),
  minStockLevel: z.coerce.number().int().min(0).default(0),
  unit: z.string().max(20).default("EA"),
});

const movementSchema = z.object({
  direction: z.enum(["IN", "OUT"]),
  quantity: z.coerce.number().int().positive(),
  reference: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

module.exports = { createStoreItemSchema, movementSchema };
