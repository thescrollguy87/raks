const svc = require("../services/dailyOpsService");
const asyncHandler = require("../utils/asyncHandler");

const listAdjustments = asyncHandler(async (req, res) => {
  res.json(await svc.listAdjustments(req.query.stationId, req.query.monthKey));
});
const createAdjustment = asyncHandler(async (req, res) => {
  res.json(await svc.createAdjustment(req.body, req.user, req));
});
const deleteAdjustment = asyncHandler(async (req, res) => {
  res.json(await svc.deleteAdjustment(req.params.id, req.user, req));
});
const getComparison = asyncHandler(async (req, res) => {
  res.json(await svc.getComparisonForMonth(req.query.stationId, req.query.monthKey));
});

module.exports = { listAdjustments, createAdjustment, deleteAdjustment, getComparison };
