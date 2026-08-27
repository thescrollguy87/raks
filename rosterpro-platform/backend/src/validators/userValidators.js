const { z } = require("zod");

const STAFF_CATEGORIES = ["B1", "B2", "CM", "NCS", "STO"];
const ROLE_NAMES = [
  "SUPER_ADMIN", "AIRLINE_ADMIN", "STATION_MANAGER", "LMM",
  "SHIFT_ENGINEER", "AME", "TECHNICIAN", "STORE_KEEPER", "READ_ONLY_AUDITOR",
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
  roles: z.array(z.enum(ROLE_NAMES)).min(1, "At least one role is required"),
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  employeeId: z.string().min(1).nullable().optional(),
  phone: z.string().min(1).nullable().optional(),
  category: z.enum(STAFF_CATEGORIES).nullable().optional(),
  designation: z.string().min(1).nullable().optional(),
  stationId: z.string().uuid().nullable().optional(),
});

const assignRolesSchema = z.object({
  roles: z.array(z.enum(ROLE_NAMES)).min(1, "At least one role is required"),
});

const importStaffQuerySchema = z.object({
  stationId: z.string().uuid(),
});

module.exports = { createUserSchema, updateUserSchema, assignRolesSchema, importStaffQuerySchema, STAFF_CATEGORIES, ROLE_NAMES };
