const auditRepo = require("../repositories/auditRepository");
const asyncHandler = require("../utils/asyncHandler");
const { isSuperAdmin, assertOwnStation, resolveStationScope } = require("../utils/stationScope");

// A single record's field-level history isn't itself filterable by
// stationId (it's keyed by entityType/entityId, not a list query) — instead
// check the entity's own station (stamped on each row when it was written)
// against the caller once the rows come back. Any row with a stationId is
// enough to identify it; an entity with no station of its own (a platform
// User's core fields, an Airline record) has none, so nothing to check.
const entityHistory = asyncHandler(async (req, res) => {
  const rows = await auditRepo.entityHistory(req.params.entityType, req.params.entityId);
  if (rows.length && !isSuperAdmin(req.user)) {
    const entityStationId = rows.find(r => r.stationId)?.stationId;
    if (entityStationId) await assertOwnStation(req.user, entityStationId);
  }
  res.json(rows);
});

const listAuditTrail = asyncHandler(async (req, res) => {
  const { from, to, stationId: requestedStationId, ...rest } = req.query;
  const scope = await resolveStationScope(req.user, requestedStationId);
  res.json(await auditRepo.listAuditTrail({
    ...rest, ...scope, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined,
  }));
});

const listActivity = asyncHandler(async (req, res) => {
  const { from, to, stationId: requestedStationId, ...rest } = req.query;
  const scope = await resolveStationScope(req.user, requestedStationId);
  res.json(await auditRepo.listActivity({
    ...rest, ...scope, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined,
  }));
});

module.exports = { entityHistory, listAuditTrail, listActivity };
