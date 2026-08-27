const auditRepo = require("../repositories/auditRepository");
const asyncHandler = require("../utils/asyncHandler");
const { isAirlineWide } = require("../utils/stationScope");

const entityHistory = asyncHandler(async (req, res) => {
  res.json(await auditRepo.entityHistory(req.params.entityType, req.params.entityId));
});

const listAuditTrail = asyncHandler(async (req, res) => {
  const { from, to, ...rest } = req.query;
  res.json(await auditRepo.listAuditTrail({ ...rest, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined }));
});

const listActivity = asyncHandler(async (req, res) => {
  const { from, to, ...rest } = req.query;
  // Station-scoped roles only ever see activity from people at their own
  // station — an airline-wide caller can see everything.
  const stationId = isAirlineWide(req.user) ? undefined : req.user.stationId;
  res.json(await auditRepo.listActivity({ ...rest, stationId, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined }));
});

module.exports = { entityHistory, listAuditTrail, listActivity };
