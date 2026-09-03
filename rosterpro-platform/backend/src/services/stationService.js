const stationRepo = require("../repositories/stationRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const { isSuperAdmin } = require("../utils/stationScope");

// A non-SUPER_ADMIN's airlineId is never taken from the request body — same
// "derive it, don't trust it" rule as flightService.createFlight — so an
// AIRLINE_ADMIN can only ever add a station to their OWN airline, no matter
// what airlineId they pass. Only SUPER_ADMIN, who has no fixed airline of
// their own, actually supplies one (see stationValidators.createStationSchema).
async function createStation(body, actor, req) {
  const airlineId = isSuperAdmin(actor) ? body.airlineId : actor.airlineId;
  if (!airlineId) throw ApiError.badRequest("airlineId is required");

  const iataCode = body.iataCode.toUpperCase();
  const existing = await stationRepo.findStationByAirlineAndIata(airlineId, iataCode);
  if (existing) throw ApiError.conflict(`A station with IATA code "${iataCode}" already exists for this airline`);

  const station = await stationRepo.createStation({
    airlineId, name: body.name, iataCode,
    icaoCode: body.icaoCode ? body.icaoCode.toUpperCase() : null,
    actorId: actor.sub,
  });

  await auditTrail.recordCreate("Station", station.id, station.id, actor, req);
  await auditTrail.logActivity("Station created", `${station.iataCode} — ${station.name}`, station.id, actor, req);

  return station;
}

module.exports = { createStation };
