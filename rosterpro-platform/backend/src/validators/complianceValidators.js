const { z } = require("zod");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD");

const qualificationSchema = z.object({
  userId: z.string().uuid(),
  qualCode: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  issuedDate: isoDate,
  expiryDate: isoDate,
  attachmentId: z.string().uuid().optional(),
});

const licenseSchema = z.object({
  userId: z.string().uuid(),
  licenseNo: z.string().min(1).max(100),
  category: z.string().min(1).max(50),
  issuingAuthority: z.string().max(100).default("DGCA"),
  issuedDate: isoDate,
  expiryDate: isoDate,
  attachmentId: z.string().uuid().optional(),
});

const trainingSchema = z.object({
  userId: z.string().uuid(),
  courseName: z.string().min(1).max(200),
  provider: z.string().max(200).optional(),
  completedDate: isoDate,
  validUntil: isoDate.optional(),
  attachmentId: z.string().uuid().optional(),
});

const authorizationSchema = z.object({
  userId: z.string().uuid(),
  scope: z.string().min(1).max(200),
  grantedDate: isoDate,
  expiryDate: isoDate.optional(),
});

const complianceQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  status: z.enum(["VALID", "EXPIRING", "EXPIRED", "BLOCKED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

module.exports = {
  qualificationSchema, licenseSchema, trainingSchema, authorizationSchema, complianceQuerySchema,
};
