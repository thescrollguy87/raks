const svc = require("../services/ruleBuilderService");
const asyncHandler = require("../utils/asyncHandler");

const listStaffGroups = asyncHandler(async (req, res) => {
  res.json(await svc.listStaffGroups(req.query.stationId));
});
const upsertStaffGroup = asyncHandler(async (req, res) => {
  res.json(await svc.upsertStaffGroup(req.body, req.user, req));
});
const deleteStaffGroup = asyncHandler(async (req, res) => {
  res.json(await svc.deleteStaffGroup(req.params.id, req.user, req));
});

const listRules = asyncHandler(async (req, res) => {
  res.json(await svc.listRules(req.query.stationId));
});
const upsertRule = asyncHandler(async (req, res) => {
  res.json(await svc.upsertRule(req.body, req.user, req));
});
const deleteRule = asyncHandler(async (req, res) => {
  res.json(await svc.deleteRule(req.params.id, req.user, req));
});

module.exports = { listStaffGroups, upsertStaffGroup, deleteStaffGroup, listRules, upsertRule, deleteRule };
