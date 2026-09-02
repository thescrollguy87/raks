const repo = require("../repositories/flightRepository");
const stationRepo = require("../repositories/stationRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const { assertOwnStation } = require("../utils/stationScope");

// airlineId is NEVER taken from the request body — a client could otherwise
// claim any airlineId regardless of which station the flight is actually
// tied to, planting a record that doesn't belong to the tenant it says it
// does. It's always derived from the target station's own real airlineId,
// the same station requireOwnStation("body") on the route already confirms
// belongs to the actor (or, for SUPER_ADMIN, whichever airline that station
// genuinely belongs to).
async function createFlight(body, actor, req) {
  const station = await stationRepo.findStationAirlineId(body.stationId);
  if (!station) throw ApiError.notFound("Station not found");

  const flight = await repo.createFlight({
    airlineId: station.airlineId, stationId: body.stationId, aircraftId: body.aircraftId || null,
    flightNumber: body.flightNumber.toUpperCase(),
    scheduledIn: body.scheduledIn ? new Date(body.scheduledIn) : null,
    scheduledOut: body.scheduledOut ? new Date(body.scheduledOut) : null,
    createdById: actor.sub, updatedById: actor.sub,
  });
  await auditTrail.recordCreate("Flight", flight.id, flight.stationId, actor, req);
  return flight;
}

async function updateFlightStatus(id, body, actor, req) {
  const existing = await repo.findFlightById(id);
  if (!existing) throw ApiError.notFound("Flight not found");
  await assertOwnStation(actor, existing.stationId);

  const data = {
    status: body.status,
    actualIn: body.actualIn ? new Date(body.actualIn) : existing.actualIn,
    actualOut: body.actualOut ? new Date(body.actualOut) : existing.actualOut,
    updatedById: actor.sub,
  };
  const updated = await repo.updateFlightStatus(id, data);
  await auditTrail.recordUpdate("Flight", id, existing.stationId, { status: existing.status }, { status: body.status }, actor, req);
  return updated;
}

async function recordDelay(body, actor, req) {
  const flight = await repo.findFlightById(body.flightId);
  if (!flight) throw ApiError.notFound("Flight not found");
  await assertOwnStation(actor, flight.stationId);

  const delay = await repo.createDelay({
    flightId: body.flightId, delayCode: body.delayCode, minutes: body.minutes,
    ataChapter: body.ataChapter || null, description: body.description,
    rectification: body.rectification || null,
    createdById: actor.sub, updatedById: actor.sub,
  });
  await auditTrail.recordCreate("EngineeringDelay", delay.id, flight.stationId, actor, req);
  await auditTrail.logActivity(
    "Engineering delay logged", `${flight.flightNumber}: ${body.delayCode} (${body.minutes}min)`, flight.stationId, actor, req
  );
  return delay;
}

function listForStation(stationId, from, to) {
  return repo.listFlightsForStation(stationId, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
}

function listDelaysForStation(stationId, from, to) {
  return repo.listDelaysForStation(stationId, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
}

module.exports = { createFlight, updateFlightStatus, recordDelay, listForStation, listDelaysForStation };
