const repo = require("../repositories/airlineRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const { hashPassword, isPasswordStrong } = require("../utils/password");

// SUPER_ADMIN-only tenant provisioning — see airlineRoutes.js. A duplicate
// icaoCode/iataCode/email surfaces as a clean 409 via errorHandler.js's
// P2002 translation, same as every other unique-constraint conflict in
// this app; no special handling needed here for that.
async function createAirline(body, actor, req) {
  if (!isPasswordStrong(body.admin.password)) {
    throw ApiError.badRequest("Admin password must be at least 10 characters and include a letter and a number");
  }

  const passwordHash = await hashPassword(body.admin.password);
  const { airline, station, admin } = await repo.createAirlineWithAdmin({
    airline: body.airline, station: body.station, admin: body.admin, passwordHash, actorId: actor.sub,
  });

  await auditTrail.recordCreate("Airline", airline.id, null, actor, req);
  await auditTrail.logActivity(
    "Tenant created",
    `${airline.name} (${airline.icaoCode}) — station ${station.name}, admin ${admin.email}`,
    null, actor, req
  );

  return {
    airline,
    station: { id: station.id, name: station.name, iataCode: station.iataCode },
    admin: { id: admin.id, fullName: admin.fullName, email: admin.email },
  };
}

module.exports = { createAirline };
