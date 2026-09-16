const officeLocationRepo = require("../repositories/officeLocationRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const { assertOwnStation, resolveStationScope } = require("../utils/stationScope");

async function listLocations(actor, { stationId }) {
  const scope = await resolveStationScope(actor, stationId);
  return officeLocationRepo.list(scope);
}

async function createLocation(body, actor, req) {
  await assertOwnStation(actor, body.stationId);
  const location = await officeLocationRepo.create({ ...body, actorId: actor.sub });
  await auditTrail.recordCreate("OfficeLocation", location.id, body.stationId, actor, req);
  await auditTrail.logActivity(
    "Office location added", `${location.name} (${location.radiusMeters}m radius)`, body.stationId, actor, req
  );
  return location;
}

async function updateLocation(id, body, actor, req) {
  const existing = await officeLocationRepo.findById(id);
  if (!existing) throw ApiError.notFound("Office location not found");
  await assertOwnStation(actor, existing.stationId);

  const updated = await officeLocationRepo.update(id, body, actor.sub);
  await auditTrail.recordUpdate(
    "OfficeLocation", id, existing.stationId,
    { name: existing.name, radiusMeters: existing.radiusMeters, isActive: existing.isActive },
    { name: updated.name, radiusMeters: updated.radiusMeters, isActive: updated.isActive },
    actor, req
  );
  return updated;
}

async function deleteLocation(id, actor, req) {
  const existing = await officeLocationRepo.findById(id);
  if (!existing) throw ApiError.notFound("Office location not found");
  await assertOwnStation(actor, existing.stationId);

  await officeLocationRepo.softDelete(id, actor.sub);
  await auditTrail.recordDelete("OfficeLocation", id, existing.stationId, actor, req);
  await auditTrail.logActivity("Office location removed", existing.name, existing.stationId, actor, req);
}

module.exports = { listLocations, createLocation, updateLocation, deleteLocation };
