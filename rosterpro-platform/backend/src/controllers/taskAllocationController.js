// TASK ALLOCATION MODULE — its own controller, separate from every existing
// *Controller.js file.
const env = require("../config/env");
const taskAllocationService = require("../services/taskAllocationService");
const asyncHandler = require("../utils/asyncHandler");

// Public (no auth) — lets the frontend hide the entire nav section without
// an authenticated call. Returns no other config, nothing sensitive.
const enabled = (req, res) => res.json({ enabled: env.taskAllocationEnabled });

// ─── Section 6: Roster sync status / availability ────────────────────────────
const rosterSyncStatus = asyncHandler(async (req, res) => {
  const { stationId, date } = req.query;
  res.json(await taskAllocationService.getRosterSyncStatus(stationId, date));
});
const availabilitySummary = asyncHandler(async (req, res) => {
  const { stationId, date } = req.query;
  res.json(await taskAllocationService.getAvailabilitySummary(stationId, date));
});

// ─── Flight Instances ─────────────────────────────────────────────────────────
const listFlightInstances = asyncHandler(async (req, res) => {
  const { stationId, dateFrom, dateTo } = req.query;
  res.json(await taskAllocationService.listFlightInstances(stationId, dateFrom, dateTo));
});
const upsertFlightInstance = asyncHandler(async (req, res) => {
  res.json(await taskAllocationService.upsertFlightInstance(req.body.stationId, req.body, req.user));
});
const deleteFlightInstance = asyncHandler(async (req, res) => {
  await taskAllocationService.deleteFlightInstance(req.params.id, req.user);
  res.json({ ok: true });
});
const replaceFlightInstances = asyncHandler(async (req, res) => {
  const { stationId, flightDate, rows } = req.body;
  res.json(await taskAllocationService.replaceFlightInstancesForDate(stationId, flightDate, rows, req.user));
});
const syncFlightInstances = asyncHandler(async (req, res) => {
  const { stationId, flightDate } = req.body;
  res.json(await taskAllocationService.syncFlightInstancesFromFlightSchedule(stationId, flightDate, req.user));
});

// ─── Rules / Settings / Travel Time ───────────────────────────────────────────
const listRules = asyncHandler(async (req, res) => res.json(await taskAllocationService.listRules(req.query.stationId)));
const upsertRule = asyncHandler(async (req, res) => res.json(await taskAllocationService.upsertRule(req.body.stationId, req.body, req.user)));
const deleteRule = asyncHandler(async (req, res) => { await taskAllocationService.deleteRule(req.params.id, req.user); res.json({ ok: true }); });

const getSettings = asyncHandler(async (req, res) => res.json(await taskAllocationService.getSettings(req.query.stationId)));
const updateSettings = asyncHandler(async (req, res) => res.json(await taskAllocationService.updateSettings(req.query.stationId, req.body, req.user)));

const listTravelTimes = asyncHandler(async (req, res) => res.json(await taskAllocationService.listTravelTimes(req.query.stationId)));
const upsertTravelTime = asyncHandler(async (req, res) => res.json(await taskAllocationService.upsertTravelTime(req.body.stationId, req.body, req.user)));
const deleteTravelTime = asyncHandler(async (req, res) => { await taskAllocationService.deleteTravelTime(req.params.id); res.json({ ok: true }); });

// ─── Task Generator ───────────────────────────────────────────────────────────
const generateTasks = asyncHandler(async (req, res) => res.json(await taskAllocationService.generateTasks(req.body.stationId, req.body.date, req.user)));

// ─── Tasks / Task Board / Unassigned ─────────────────────────────────────────
const listTasks = asyncHandler(async (req, res) => res.json(await taskAllocationService.listTasks(req.query.stationId, req.query)));
const getTask = asyncHandler(async (req, res) => res.json(await taskAllocationService.getTask(req.query.stationId, req.params.id)));
const createTask = asyncHandler(async (req, res) => res.json(await taskAllocationService.createManualTask(req.body.stationId, req.body, req.user)));
const cancelTask = asyncHandler(async (req, res) => res.json(await taskAllocationService.cancelTask(req.body.stationId, req.params.id, req.user, req.body.reason)));

const listUnassigned = asyncHandler(async (req, res) => {
  const { stationId, dateFrom, dateTo } = req.query;
  res.json(await taskAllocationService.listUnassignedTasks(stationId, dateFrom, dateTo));
});
const explainUnassigned = asyncHandler(async (req, res) => res.json(await taskAllocationService.explainUnassignedTask(req.query.stationId, req.params.id)));

// ─── Candidates / Eligibility ─────────────────────────────────────────────────
const getCandidates = asyncHandler(async (req, res) => res.json(await taskAllocationService.getCandidates(req.query.stationId, req.params.taskId)));

// ─── Allocation / Manual / Reallocation / What-If ────────────────────────────
const allocate = asyncHandler(async (req, res) => res.json(await taskAllocationService.runAutoAllocation(req.body.stationId, req.body, req.user)));
const manualAssignment = asyncHandler(async (req, res) => res.json(await taskAllocationService.manualAssign(req.body.stationId, req.body, req.user)));
const reallocate = asyncHandler(async (req, res) => res.json(await taskAllocationService.reallocateTask(req.body.stationId, req.body.taskId, req.user, req.body.trigger, req.body.triggerDetail)));
const whatIf = asyncHandler(async (req, res) => res.json(await taskAllocationService.runWhatIf(req.body.stationId, req.body, req.user)));
const commitWhatIf = asyncHandler(async (req, res) => res.json(await taskAllocationService.commitWhatIf(req.body.stationId, req.body.runId, req.user)));

// ─── Conflicts ────────────────────────────────────────────────────────────────
const listConflicts = asyncHandler(async (req, res) => res.json(await taskAllocationService.listConflicts(req.query.stationId, req.query)));
const detectConflicts = asyncHandler(async (req, res) => {
  const { stationId, dateFrom, dateTo } = req.body;
  res.json(await taskAllocationService.detectConflicts(stationId, dateFrom, dateTo));
});

// ─── Allocation History ───────────────────────────────────────────────────────
const history = asyncHandler(async (req, res) => res.json(await taskAllocationService.listHistory(req.query.stationId, req.query)));
const listRuns = asyncHandler(async (req, res) => res.json(await taskAllocationService.listRuns(req.query.stationId)));
const getRun = asyncHandler(async (req, res) => res.json(await taskAllocationService.getRun(req.query.stationId, req.params.id)));

module.exports = {
  enabled, rosterSyncStatus, availabilitySummary,
  listFlightInstances, upsertFlightInstance, deleteFlightInstance, replaceFlightInstances, syncFlightInstances,
  listRules, upsertRule, deleteRule,
  getSettings, updateSettings,
  listTravelTimes, upsertTravelTime, deleteTravelTime,
  generateTasks,
  listTasks, getTask, createTask, cancelTask, listUnassigned, explainUnassigned,
  getCandidates,
  allocate, manualAssignment, reallocate, whatIf, commitWhatIf,
  listConflicts, detectConflicts,
  history, listRuns, getRun,
};
