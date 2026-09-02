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
  await assertOwnStation(actor, input.stationId);
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
  await assertOwnStation(actor, input.stationId);
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
// Default task names — matches the reference PWA's own Task Master seed
// list exactly, so a station that's never touched this tab still sees the
// same named rows the reference ships with (all at zero frequency until a
// planner fills them in) rather than an empty table with no starting point.
const PLANNED_TASK_DEFAULTS = [
  "Layover Inspection", "Weekly Inspection", "Service Check", "A-Check",
  "Borescope Inspection", "Planned Defect Rectification", "Component Replacement (Planned)",
];
const UNPLANNED_TASK_DEFAULTS = [
  "Wheel Change", "Brake Change", "Troubleshooting", "Component Replacement (Unplanned)",
  "Engine Change", "Water Wash", "Escape Slide Replacement", "AOG Rectification",
];

// KNOWN ISSUE (flagged, not fixed here — see the multi-tenancy audit's
// final report): this silently CREATES 7 real PlannedTaskMaster rows in
// the database the first time a station with none yet has this endpoint
// called — for a brand-new airline's very first station, a mere GET
// request attaches a starter task list nobody asked for, which is exactly
// the "shared default task master silently attached to every new
// airline" pattern the rest of this audit eliminated everywhere else.
// It's lower severity than the access-control gaps fixed elsewhere (the
// rows are generic, all-zero placeholders — never copied from another
// airline's real configured data, and they don't expose anyone's
// information) but it's still the wrong default. Not changed in this pass
// because the obvious fix — synthesizing these in memory instead of
// persisting them, the same way getWorkloadConfig/listMandatoryCoverageRules
// already do below — breaks AutoRosterPage.jsx's edit flow: it matches
// rows by `x.id === t.id` and multiple synthesized rows sharing id: null
// would collide (editing one would edit all of them). Fixing this
// properly needs a coordinated frontend change (a stable per-row key that
// isn't the DB id) alongside the backend one.
async function listPlannedTasks(stationId) {
  let tasks = await repo.listPlannedTasks(stationId);
  if (tasks.length === 0) {
    for (let i = 0; i < PLANNED_TASK_DEFAULTS.length; i++) {
      await repo.upsertPlannedTask({
        stationId, name: PLANNED_TASK_DEFAULTS[i], frequency: 0, frequencyUnit: "per_month",
        avgDurationMin: 0, reqB1: 0, reqB2: 0, reqCM: 0, reqNCS: 0, preferredShift: "N", sortOrder: i,
      });
    }
    tasks = await repo.listPlannedTasks(stationId);
  }
  return tasks;
}

async function upsertPlannedTask(input, actor, req) {
  await assertOwnStation(actor, input.stationId);
  const task = await repo.upsertPlannedTask(input);
  await auditTrail.logActivity("Planned task master saved", task.name, task.stationId, actor, req);
  return task;
}

async function deletePlannedTask(id, actor, req) {
  const task = await repo.findPlannedTask(id);
  if (!task) throw ApiError.notFound("Planned task not found");
  await assertOwnStation(actor, task.stationId);
  await repo.deletePlannedTask(id);
  await auditTrail.logActivity("Planned task master removed", task.name, task.stationId, actor, req);
  return { id };
}

// Same known issue as listPlannedTasks above (silently persists a starter
// template on first read) and the same reason it's flagged rather than
// changed here.
async function listUnplannedTasks(stationId) {
  let tasks = await repo.listUnplannedTasks(stationId);
  if (tasks.length === 0) {
    for (let i = 0; i < UNPLANNED_TASK_DEFAULTS.length; i++) {
      await repo.upsertUnplannedTask({
        stationId, name: UNPLANNED_TASK_DEFAULTS[i], avgFreqPerMonth: 0,
        avgDurationMin: 0, reqB1: 0, reqB2: 0, reqCM: 0, reqNCS: 0, preferredShift: "Any", sortOrder: i,
      });
    }
    tasks = await repo.listUnplannedTasks(stationId);
  }
  return tasks;
}

async function upsertUnplannedTask(input, actor, req) {
  await assertOwnStation(actor, input.stationId);
  const task = await repo.upsertUnplannedTask(input);
  await auditTrail.logActivity("Unplanned task master saved", task.name, task.stationId, actor, req);
  return task;
}

async function deleteUnplannedTask(id, actor, req) {
  const task = await repo.findUnplannedTask(id);
  if (!task) throw ApiError.notFound("Unplanned task not found");
  await assertOwnStation(actor, task.stationId);
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
  await assertOwnStation(actor, input.stationId);
  const entry = await repo.createManualDemand({ ...input, actorId: actor.sub });
  await auditTrail.logActivity("Manual demand entry added", `${entry.date.toISOString().slice(0, 10)}: B1${entry.reqB1} B2${entry.reqB2} CM${entry.reqCM} NCS${entry.reqNCS}`, entry.stationId, actor, req);
  return entry;
}

async function deleteManualDemand(id, actor, req) {
  const entry = await repo.findManualDemand(id);
  if (!entry) throw ApiError.notFound("Manual demand entry not found");
  await assertOwnStation(actor, entry.stationId);
  await repo.deleteManualDemand(id);
  await auditTrail.logActivity("Manual demand entry removed", entry.date.toISOString().slice(0, 10), entry.stationId, actor, req);
  return { id };
}

// Powers the Planned Task Master's "auto, from Flight Schedule" source
// rows — the real Transit/PDC occurrence counts for a target month, using
// the station's own saved thresholds/ratios, so the table shows exactly
// what generation itself will derive from the same import rather than a
// separate, potentially-drifted estimate.
async function getFlightDerivedSummary(stationId, year, month) {
  const flightScheduleService = require("./flightScheduleService");
  const { buildTransitWorkloadEvents, buildPDCWorkloadEvents } = require("../utils/workloadEngine");
  const rosterRepo = require("../repositories/rosterRepository");

  const [config, schedule, station] = await Promise.all([
    getWorkloadConfig(stationId),
    flightScheduleService.getFlightScheduleForMonth(stationId, year, month),
    rosterRepo.findStationById(stationId),
  ]);
  if (!schedule) return { imported: false };

  const homeStation = station?.iataCode;
  const transitEvents = buildTransitWorkloadEvents(schedule.turnRecords, year, month, homeStation, config);
  const pdcEvents = buildPDCWorkloadEvents(schedule.turnRecords, schedule.charterRecords, year, month, homeStation, config);
  return {
    imported: true,
    transitOccurrences: transitEvents.length,
    pdcOccurrences: pdcEvents.length,
    transitVsPdcThresholdMinutes: config.transitVsPdcThresholdMinutes,
    movementsPerB1Staff: config.movementsPerB1Staff,
    movementsPerCMStaff: config.movementsPerCMStaff,
    movementsPerNCSStaff: config.movementsPerNCSStaff,
  };
}

module.exports = {
  getWorkloadConfig, upsertWorkloadConfig,
  listMandatoryCoverageRules, upsertMandatoryCoverageRule, getMandatoryCoverageConfigForGeneration,
  listPlannedTasks, upsertPlannedTask, deletePlannedTask,
  listUnplannedTasks, upsertUnplannedTask, deleteUnplannedTask,
  listManualDemand, createManualDemand, deleteManualDemand,
  getFlightDerivedSummary,
};
