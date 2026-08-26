const svc = require("../services/qualityService");
const asyncHandler = require("../utils/asyncHandler");

const raiseFinding = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.raiseFinding(req.body, req.user, req));
});
const updateFinding = asyncHandler(async (req, res) => {
  res.json(await svc.updateFinding(req.params.id, req.body, req.user, req));
});
const listFindings = asyncHandler(async (req, res) => {
  res.json(await svc.listFindingsForStation(req.params.stationId, req.query.status));
});
const openCapa = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.openCapa(req.body, req.user, req));
});
const closeCapa = asyncHandler(async (req, res) => {
  res.json(await svc.closeCapa(req.params.id, req.body, req.user, req));
});
const listCapasForOwner = asyncHandler(async (req, res) => {
  res.json(await svc.listCapasForOwner(req.params.ownerId, req.query.status));
});
const overdue = asyncHandler(async (req, res) => {
  res.json(await svc.listOverdue());
});

module.exports = { raiseFinding, updateFinding, listFindings, openCapa, closeCapa, listCapasForOwner, overdue };
