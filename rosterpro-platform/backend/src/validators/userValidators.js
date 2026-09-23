const { z } = require("zod");

const STAFF_CATEGORIES = ["B1", "B2", "CM", "NCS", "STO"];
const ROLE_NAMES = [
  "SUPER_ADMIN", "AIRLINE_ADMIN", "STATION_MANAGER", "LMM", "SHIFT_INCHARGE",
  "DUTY_ENGINEER", "SR_AME", "AME", "CM", "SR_TECH", "TECH", "JR_TECH", "NCS", "STORES",
  "READ_ONLY_AUDITOR",
];

// Password strength itself is checked in the service (isPasswordStrong),
// same as authService's register/reset flows — kept out of the zod schema
// so both places share one definition of "strong enough."
const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  fullName: z.string().min(1),
  employeeId: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  category: z.enum(STAFF_CATEGORIES).optional(),
  designation: z.string().min(1).optional(),
  stationId: z.string().uuid().optional(),
  reportsToId: z.string().uuid().optional(),
  roles: z.array(z.enum(ROLE_NAMES)).min(1, "At least one role is required"),
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  employeeId: z.string().min(1).nullable().optional(),
  phone: z.string().min(1).nullable().optional(),
  category: z.enum(STAFF_CATEGORIES).nullable().optional(),
  designation: z.string().min(1).nullable().optional(),
  stationId: z.string().uuid().nullable().optional(),
  reportsToId: z.string().uuid().nullable().optional(),
  // Trimmed + lowercased here (before the .email() format check runs), so
  // "  Jai.Singh@Akasaair.com " and "jai.singh@akasaair.com" validate and
  // compare identically — the uniqueness check and audit diff in
  // userService.updateStaff both rely on this already being canonical.
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.string().email()).optional(),
  // Omit this field entirely to leave the password unchanged — strength is
  // checked in the service (isPasswordStrong), same as createStaff and
  // authService's reset flow, so both places share one definition of
  // "strong enough."
  password: z.string().min(1).optional(),
});

const assignRolesSchema = z.object({
  roles: z.array(z.enum(ROLE_NAMES)).min(1, "At least one role is required"),
});

const importStaffQuerySchema = z.object({
  stationId: z.string().uuid(),
});

module.exports = { createUserSchema, updateUserSchema, assignRolesSchema, importStaffQuerySchema, STAFF_CATEGORIES, ROLE_NAMES };
