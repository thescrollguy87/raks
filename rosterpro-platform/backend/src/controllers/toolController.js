const svc = require("../services/toolService");
const asyncHandler = require("../utils/asyncHandler");
const { isAirlineWide } = require("../utils/stationScope");

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
  const results = await svc.listDueForCalibration(parseInt(req.query.days, 10) || undefined);
  // This isn't a :stationId route (it spans every station so the internal
  // reminder cron — see jobs/scheduledJobs.js — can use the same service
  // function unscoped), so the station filter happens here instead of via
  // requireOwnStation: a Station Manager only sees their own station's
  // tools, an Airline Admin/Super Admin sees all of them.
  const filtered = isAirlineWide(req.user) ? results : results.filter(t => t.stationId === req.user.stationId);
  res.json(filtered);
});

module.exports = { create, calibrate, issue, returnTool, listForStation, dueForCalibration };
