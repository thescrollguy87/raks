const svc = require("../services/toolService");
const asyncHandler = require("../utils/asyncHandler");

const create = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createTool(req.body, req.user, req));
});
const calibrate = asyncHandler(async (req, res) => {
  res.json(await svc.recordCalibration(req.params.id, req.body, req.user, req));
});
const issue = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.issueTool(req.params.id, req.body, req.user, req));
});
const returnTool = asyncHandler(async (req, res) => {
  res.json(await svc.returnTool(req.body.issueId, req.user, req));
});
const listForStation = asyncHandler(async (req, res) => {
  res.json(await svc.listForStation(req.params.stationId));
});
const dueForCalibration = asyncHandler(async (req, res) => {
  res.json(await svc.listDueForCalibration(parseInt(req.query.days, 10) || undefined));
});

module.exports = { create, calibrate, issue, returnTool, listForStation, dueForCalibration };
