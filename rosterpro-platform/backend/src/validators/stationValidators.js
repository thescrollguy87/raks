const { z } = require("zod");

// airlineId is optional here on purpose: only SUPER_ADMIN (who has no
// fixed airline of their own) actually uses it — see stationService's
// createStation, which forces it to actor.airlineId for anyone else and
// ignores whatever a non-SUPER_ADMIN might pass.
const createStationSchema = z.object({
  airlineId: z.string().uuid().optional(),
  name: z.string().min(1),
  iataCode: z.string().min(2).max(10),
  icaoCode: z.string().min(2).max(10).optional(),
});

module.exports = { createStationSchema };
