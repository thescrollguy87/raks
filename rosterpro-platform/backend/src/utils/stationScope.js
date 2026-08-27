const ApiError = require("./ApiError");

// SUPER_ADMIN sees every airline; AIRLINE_ADMIN sees every station within
// their own airline. Everyone else (STATION_MANAGER, LMM, SHIFT_ENGINEER,
// AME, TECHNICIAN, STORE_KEEPER, READ_ONLY_AUDITOR) is scoped to exactly
// the one station on their own token — this is the same distinction
// userController.list already drew inline; this is that logic made
// reusable so every station-scoped endpoint enforces it the same way,
// not just the ones that happened to remember to check.
function isAirlineWide(actor) {
  return actor.roles?.includes("SUPER_ADMIN") || actor.roles?.includes("AIRLINE_ADMIN");
}

// Throws 403 if the actor isn't airline-wide and targetStationId isn't
// their own station. Use this in services for anything resolved from a
// record (a leave request's owner, a tool's station, a flight's station) —
// where the "requested station" isn't a route param, it's whatever the
// looked-up row actually belongs to.
function assertOwnStation(actor, targetStationId) {
  if (isAirlineWide(actor)) return;
  if (!targetStationId || targetStationId !== actor.stationId) {
    throw ApiError.forbidden("You can only access your own station's data");
  }
}

// Express middleware for routes where the requested stationId IS a route
// param/query/body value up front (dashboard/:stationId, ?stationId=... on
// roster/reports, stationId in a create-tool/create-flight body). Rejects
// before the controller/service even runs, rather than fetching data for
// a station the caller has no business seeing and filtering it out after.
function requireOwnStation(source) {
  return function (req, res, next) {
    if (isAirlineWide(req.user)) return next();
    const stationId = source
      ? req[source]?.stationId
      : req.params?.stationId || req.query?.stationId || req.body?.stationId;
    if (!stationId || stationId !== req.user.stationId) {
      return next(ApiError.forbidden("You can only access your own station's data"));
    }
    next();
  };
}

module.exports = { isAirlineWide, assertOwnStation, requireOwnStation };
