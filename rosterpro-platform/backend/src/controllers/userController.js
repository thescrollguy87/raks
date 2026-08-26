const asyncHandler = require("../utils/asyncHandler");
const userListRepo = require("../repositories/userListRepository");

// This endpoint is the reference implementation for how every Module 4
// domain list endpoint should look: requireAuth + requirePermission in the
// route, station/airline scoping applied here from the caller's own token
// (never trust a client-supplied stationId for scoping — only use it to
// narrow further within what the token already allows).
const list = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page || "1", 10);
  const pageSize = Math.min(parseInt(req.query.pageSize || "20", 10), 100);

  // SUPER_ADMIN/AIRLINE_ADMIN can see across the airline; everyone else is
  // scoped to their own station. This is the RBAC pattern extending beyond
  // "can you call this endpoint at all" into "which rows can you see."
  const scopedToStation = !req.user.roles.some(r => ["SUPER_ADMIN", "AIRLINE_ADMIN"].includes(r));

  const result = await userListRepo.listPaginated({
    page, pageSize,
    stationId: scopedToStation ? req.user.stationId : undefined,
    airlineId: req.user.roles.includes("SUPER_ADMIN") ? undefined : req.user.airlineId,
  });
  res.json(result);
});

module.exports = { list };
