const repo = require("../repositories/workloadConfigRepository");
const auditTrail = require("../utils/auditTrail");
const ApiError = require("../utils/ApiError");
const { assertOwnStation } = require("../utils/stationScope");

// Mirrors the schema's own column defaults — a station with no config row
// yet still sees a fully-populated form, not a blank one, and generation
// code that reads this before any station has ever saved a config gets the
// same numbers either way.
const DEFAULT_CONFIG = {
  transitMinutesDefault: 40, pdcMinutesBeforeDeparture: 60, clashProximityMinutes: 60,
  transitVsPdcThresholdMinutes: 120, movementsPerB1Staff: 4, movementsPerCMStaff: 1, movementsPerNCSStaff: 1,
  unplannedMethod: "frequency", unplannedManpowerHoursPerMonth: 0, unplannedBufferPct: 20,
  bufferB1: 0, bufferB2: 0, bufferCM: 0, bufferNCS: 0,
};

async function getWorkloadConfig(stationId) {
  const config = await repo.getConfig(stationId);
  return config ? { ...DEFAULT_CONFIG, ...config } : { stationId, ...DEFAULT_CONFIG };
}

async function upsertWorkloadConfig(input, actor, req) {
  assertOwnStation(actor, input.stationId);
  const config = await repo.upsertConfig({ ...input, actorId: actor.sub });
  await auditTrail.logActivity("Workload config saved", `Station ${config.stationId} standard durations/ratios updated`, config.stationId, actor, req);
  return config;
}

// Default Mandatory Minimum Coverage — matches
// rosterGenerationAlgorithm.js's own DEFAULT_MANDATORY_COVERAGE_CONFIG so a
// station with no explicit rules saved yet generates exactly as before.
const DEFAULT_MANDATORY_RULES = [
  { category: "B1", shift: "M", enabled: true, minCount: 1 },
  { category: "B1", shift: "A", enabled: true, minCount: 1 },
  { category: "B1", shift: "N", enabled: true, minCount: 1 },
  { category: "B2", shift: "M", enabled: false, minCount: 1 },
  { category: "B2", shift: "A", enabled: false, minCount: 1 },
  { category: "B2", shift: "N", enabled: true, minCount: 1 },
  { category: "CM", shift: "M", enabled: false, minCount: 1 },
  { category: "CM", shift: "A", enabled: false, minCount: 1 },
  { category: "CM", shift: "N", enabled: false, minCount: 1 },
];

async function listMandatoryCoverageRules(stationId) {
  const saved = await repo.listMandatoryCoverageRules(stationId);
  const byKey = new Map(saved.map(r => [`${r.category}:${r.shift}`, r]));
  return DEFAULT_MANDATORY_RULES.map(d => byKey.get(`${d.category}:${d.shift}`) || { stationId, ...d });
}

async function upsertMandatoryCoverageRule(input, actor, req) {
  assertOwnStation(actor, input.stationId);
  const rule = await repo.upsertMandatoryCoverageRule(input);
  await auditTrail.logActivity("Mandatory coverage rule saved", `${rule.category} / ${rule.shift}: ${rule.enabled ? `min ${rule.minCount}` : "disabled"}`, rule.stationId, actor, req);
  return rule;
}

// Reshapes the saved rows into the {category: {shift: {enabled, min}}} grid
// buildRosterAssignments's mandatoryCoverageConfig param expects.
async function getMandatoryCoverageConfigForGeneration(stationId) {
  const rules = await listMandatoryCoverageRules(stationId);
  const config = {};
  rules.forEach(r => {
    config[r.category] = config[r.category] || {};
    config[r.category][r.shift] = { enabled: r.enabled, min: r.minCount };
  });
  return config;
}

// ─── Task Masters ─────────────────────────────────────────────────────────────
function listPlannedTasks(stationId) {
  return repo.listPlannedTasks(stationId);
}

async function upsertPlannedTask(input, actor, req) {
  assertOwnStation(actor, input.stationId);
  const task = await repo.upsertPlannedTask(input);
  await auditTrail.logActivity("Planned task master saved", task.name, task.stationId, actor, req);
  return task;
}

async function deletePlannedTask(id, actor, req) {
  const task = await repo.findPlannedTask(id);
  if (!task) throw ApiError.notFound("Planned task not found");
  assertOwnStation(actor, task.stationId);
  await repo.deletePlannedTask(id);
  await auditTrail.logActivity("Planned task master removed", task.name, task.stationId, actor, req);
  return { id };
}

function listUnplannedTasks(stationId) {
  return repo.listUnplannedTasks(stationId);
}

async function upsertUnplannedTask(input, actor, req) {
  assertOwnStation(actor, input.stationId);
  const task = await repo.upsertUnplannedTask(input);
  await auditTrail.logActivity("Unplanned task master saved", task.name, task.stationId, actor, req);
  return task;
}

async function deleteUnplannedTask(id, actor, req) {
  const task = await repo.findUnplannedTask(id);
  if (!task) throw ApiError.notFound("Unplanned task not found");
  assertOwnStation(actor, task.stationId);
  await repo.deleteUnplannedTask(id);
  await auditTrail.logActivity("Unplanned task master removed", task.name, task.stationId, actor, req);
  return { id };
}

// ─── Manual Demand ────────────────────────────────────────────────────────────
function monthRange(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

function listManualDemand(stationId, monthKey) {
  const { start, end } = monthRange(monthKey);
  return repo.listManualDemand(stationId, start, end);
}

async function createManualDemand(input, actor, req) {
  assertOwnStation(actor, input.stationId);
  const entry = await repo.createManualDemand({ ...input, actorId: actor.sub });
  await auditTrail.logActivity("Manual demand entry added", `${entry.date.toISOString().slice(0, 10)}: B1${entry.reqB1} B2${entry.reqB2} CM${entry.reqCM} NCS${entry.reqNCS}`, entry.stationId, actor, req);
  return entry;
}

async function deleteManualDemand(id, actor, req) {
  const entry = await repo.findManualDemand(id);
  if (!entry) throw ApiError.notFound("Manual demand entry not found");
  assertOwnStation(actor, entry.stationId);
  await repo.deleteManualDemand(id);
  await auditTrail.logActivity("Manual demand entry removed", entry.date.toISOString().slice(0, 10), entry.stationId, actor, req);
  return { id };
}

module.exports = {
  getWorkloadConfig, upsertWorkloadConfig,
  listMandatoryCoverageRules, upsertMandatoryCoverageRule, getMandatoryCoverageConfigForGeneration,
  listPlannedTasks, upsertPlannedTask, deletePlannedTask,
  listUnplannedTasks, upsertUnplannedTask, deleteUnplannedTask,
  listManualDemand, createManualDemand, deleteManualDemand,
};
