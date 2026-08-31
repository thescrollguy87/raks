const svc = require("../services/workloadConfigService");
const asyncHandler = require("../utils/asyncHandler");

const getConfig = asyncHandler(async (req, res) => {
  res.json(await svc.getWorkloadConfig(req.query.stationId));
});
const upsertConfig = asyncHandler(async (req, res) => {
  res.json(await svc.upsertWorkloadConfig(req.body, req.user, req));
});

const listMandatoryCoverageRules = asyncHandler(async (req, res) => {
  res.json(await svc.listMandatoryCoverageRules(req.query.stationId));
});
const upsertMandatoryCoverageRule = asyncHandler(async (req, res) => {
  res.json(await svc.upsertMandatoryCoverageRule(req.body, req.user, req));
});

const listPlannedTasks = asyncHandler(async (req, res) => {
  res.json(await svc.listPlannedTasks(req.query.stationId));
});
const upsertPlannedTask = asyncHandler(async (req, res) => {
  res.json(await svc.upsertPlannedTask(req.body, req.user, req));
});
const deletePlannedTask = asyncHandler(async (req, res) => {
  res.json(await svc.deletePlannedTask(req.params.id, req.user, req));
});

const listUnplannedTasks = asyncHandler(async (req, res) => {
  res.json(await svc.listUnplannedTasks(req.query.stationId));
});
const upsertUnplannedTask = asyncHandler(async (req, res) => {
  res.json(await svc.upsertUnplannedTask(req.body, req.user, req));
});
const deleteUnplannedTask = asyncHandler(async (req, res) => {
  res.json(await svc.deleteUnplannedTask(req.params.id, req.user, req));
});

const listManualDemand = asyncHandler(async (req, res) => {
  res.json(await svc.listManualDemand(req.query.stationId, req.query.monthKey));
});
const createManualDemand = asyncHandler(async (req, res) => {
  res.json(await svc.createManualDemand(req.body, req.user, req));
});
const deleteManualDemand = asyncHandler(async (req, res) => {
  res.json(await svc.deleteManualDemand(req.params.id, req.user, req));
});

const getFlightDerivedSummary = asyncHandler(async (req, res) => {
  const { stationId, year, month } = req.query;
  res.json(await svc.getFlightDerivedSummary(stationId, Number(year), Number(month)));
});

module.exports = {
  getConfig, upsertConfig, getFlightDerivedSummary,
  listMandatoryCoverageRules, upsertMandatoryCoverageRule,
  listPlannedTasks, upsertPlannedTask, deletePlannedTask,
  listUnplannedTasks, upsertUnplannedTask, deleteUnplannedTask,
  listManualDemand, createManualDemand, deleteManualDemand,
};
