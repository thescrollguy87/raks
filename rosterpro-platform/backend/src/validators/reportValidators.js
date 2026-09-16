const { z } = require("zod");

const monthKey = z.string().regex(/^\d{4}-\d{2}$/, "Expected month as YYYY-MM");

const REPORT_TYPES = ["roster", "roster-template", "compliance", "leave", "attendance-register"];

const reportQuerySchema = z.object({
  type: z.enum(REPORT_TYPES),
  format: z.enum(["excel", "pdf", "csv"]),
  stationId: z.string().uuid(),
  monthKey: monthKey.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  // Compliance report only — narrows the station-wide report down to one
  // staff member (e.g. the "Generate Report" button on their Qualifications
  // detail view). Ignored by every other report type.
  userId: z.string().uuid().optional(),
}).refine(
  (d) => !["roster", "roster-template", "attendance-register"].includes(d.type) || !!d.monthKey,
  { message: "monthKey is required for this report", path: ["monthKey"] }
).refine(
  (d) => d.type !== "leave" || !!d.year,
  { message: "year is required for leave reports", path: ["year"] }
);

const emailReportSchema = z.object({
  type: z.enum(REPORT_TYPES),
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
