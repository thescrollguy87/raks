const { z } = require("zod");

// Password strength is checked in the service (isPasswordStrong), same
// as userValidators' createUserSchema — kept out of the zod schema so
// both share one definition of "strong enough."
const createAirlineSchema = z.object({
  airline: z.object({
    name: z.string().min(1),
    icaoCode: z.string().min(2).max(10),
    iataCode: z.string().min(2).max(5).optional(),
  }),
  station: z.object({
    name: z.string().min(1),
    iataCode: z.string().min(2).max(10),
    icaoCode: z.string().min(2).max(10).optional(),
  }),
  admin: z.object({
    fullName: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

module.exports = { createAirlineSchema };
