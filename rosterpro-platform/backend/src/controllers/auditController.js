const auditRepo = require("../repositories/auditRepository");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { isAirlineWide } = require("../utils/stationScope");

// A single record's field-level history isn't itself filterable by
// stationId (it's keyed by entityType/entityId, not a list query) — instead
// check the entity's own station (stamped on each row when it was written)
// against the caller once the rows come back. Any row with a stationId is
// enough to identify it; an entity with no station of its own (a platform
// User's core fields, an Airline record) has none, so nothing to check.
const entityHistory = asyncHandler(async (req, res) => {
  const rows = await auditRepo.entityHistory(req.params.entityType, req.params.entityId);
  if (rows.length && !isAirlineWide(req.user)) {
    const entityStationId = rows.find(r => r.stationId)?.stationId;
    if (entityStationId && entityStationId !== req.user.stationId) {
      throw ApiError.forbidden("You can only view your own station's records");
    }
  }
  res.json(rows);
});

const listAuditTrail = asyncHandler(async (req, res) => {
  const { from, to, ...rest } = req.query;
  // Station-scoped roles only ever see entries for their own station's
  // entities — an airline-wide caller can see (and optionally filter by)
  // any station.
  const stationId = isAirlineWide(req.user) ? rest.stationId : req.user.stationId;
  res.json(await auditRepo.listAuditTrail({ ...rest, stationId, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined }));
});

const listActivity = asyncHandler(async (req, res) => {
  const { from, to, ...rest } = req.query;
  // Same rule as listAuditTrail — scoped to the affected entity's own
  // station, not who happened to perform the action.
  const stationId = isAirlineWide(req.user) ? rest.stationId : req.user.stationId;
  res.json(await auditRepo.listActivity({ ...rest, stationId, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined }));
});

module.exports = { entityHistory, listAuditTrail, listActivity };
