const { z } = require("zod");

const monthKey = z.string().regex(/^\d{4}-\d{2}$/, "Expected month as YYYY-MM");

const reportQuerySchema = z.object({
  type: z.enum(["roster", "compliance", "leave"]),
  format: z.enum(["excel", "pdf", "csv"]),
  stationId: z.string().uuid(),
  monthKey: monthKey.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
}).refine(
  (d) => d.type !== "roster" || !!d.monthKey,
  { message: "monthKey is required for roster reports", path: ["monthKey"] }
).refine(
  (d) => d.type !== "leave" || !!d.year,
  { message: "year is required for leave reports", path: ["year"] }
);

const emailReportSchema = z.object({
  type: z.enum(["roster", "compliance", "leave"]),
  format: z.enum(["excel", "pdf", "csv"]),
  stationId: z.string().uuid(),
  monthKey: monthKey.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  toEmail: z.string().email(),
});

const baRosterQuerySchema = z.object({
  stationId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD"),
});

module.exports = { reportQuerySchema, emailReportSchema, baRosterQuerySchema };
