const auditRepo = require("../repositories/auditRepository");
const asyncHandler = require("../utils/asyncHandler");

const entityHistory = asyncHandler(async (req, res) => {
  res.json(await auditRepo.entityHistory(req.params.entityType, req.params.entityId));
});

const listAuditTrail = asyncHandler(async (req, res) => {
  const { from, to, ...rest } = req.query;
  res.json(await auditRepo.listAuditTrail({ ...rest, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined }));
});

const listActivity = asyncHandler(async (req, res) => {
  const { from, to, ...rest } = req.query;
  res.json(await auditRepo.listActivity({ ...rest, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined }));
});

module.exports = { entityHistory, listAuditTrail, listActivity };
