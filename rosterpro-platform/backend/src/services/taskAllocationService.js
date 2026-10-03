// TASK ALLOCATION MODULE — top-level orchestration + CRUD the controller
// calls directly. Thin by design: real logic lives in the engine/generator/
// eligibility/allocation/conflict/reallocation services this composes.
const taskAllocationConfigRepo = require("../repositories/taskAllocationConfigRepository");
const maintenanceTaskRepo = require("../repositories/maintenanceTaskRepository");
const readOnlyRosterAdapter = require("../services/readOnlyRosterAdapter");
const readOnlyFlightScheduleAdapter = require("../services/readOnlyFlightScheduleAdapter");
const taskGeneratorService = require("./taskGeneratorService");
const eligibilityEngineService = require("./eligibilityEngineService");
const allocationEngineService = require("./allocationEngineService");
const manualAllocationService = require("./manualAllocationService");
const conflictDetectionService = require("./conflictDetectionService");
const reallocationService = require("./reallocationService");
const ApiError = require("../utils/ApiError");

function dateOnly(d) { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setUTCHours(23, 59, 59, 999); return x; }

// TaskAssignment.userId (and AllocationEvent.previousUserId/newUserId,
// TaskConflict.userId) deliberately carry no Prisma relation to User (see
// schema.prisma's module banner), so every read path that shows these to
// the UI resolves names here rather than leaving a raw id on screen.
function attachAssignmentNames(tasks, nameMap) {
  for (const t of tasks) for (const a of t.assignments || []) a.userName = nameMap[a.userId] || null;
  return tasks;
}
function attachEventNames(events, nameMap) {
  for (const e of events) {
    e.previousUserName = e.previousUserId ? nameMap[e.previousUserId] || null : null;
    e.newUserName = e.newUserId ? nameMap[e.newUserId] || null : null;
  }
  return events;
}

// ─── Section 6: Published Roster status / availability summary ──────────────
function getRosterSyncStatus(stationId, date) {
  return readOnlyRosterAdapter.getPublishedRosterStatus(stationId, date);
}
function getAvailabilitySummary(stationId, date) {
  return readOnlyRosterAdapter.getAvailabilitySummary(stationId, date);
}

// ─── Flight Instances (own daily input — see schema.prisma banner) ─────────
function listFlightInstances(stationId, dateFrom, dateTo) {
  return taskAllocationConfigRepo.listFlightInstances(stationId, dateOnly(dateFrom), endOfDay(dateTo));
}
function upsertFlightInstance(stationId, body, actor) {
  // Editing an existing row — including one the Flight Schedule sync
  // created — is the person taking ownership of it: flip it to "MANUAL" so
  // a later sync (syncFlightInstancesFromFlightSchedule) never overwrites
  // their correction.
  if (body.id) return taskAllocationConfigRepo.updateFlightInstance(body.id, { ...body, source: "MANUAL", updatedById: actor.sub });
  return taskAllocationConfigRepo.createFlightInstance({ ...body, stationId, createdById: actor.sub, updatedById: actor.sub });
}
// ─── Flight Instances: auto-sync from the Flight Schedule module (Section 6) ─
async function syncFlightInstancesFromFlightSchedule(stationId, date, actor) {
  const { rows } = await readOnlyFlightScheduleAdapter.getFlightsForStationDate(stationId, date);
  const flightInstances = await taskAllocationConfigRepo.syncFlightInstancesForDate(stationId, dateOnly(date), rows, actor.sub);
  return { flightInstances, syncedCount: rows.length };
}
function deleteFlightInstance(id, actor) {
  return taskAllocationConfigRepo.deleteFlightInstance(id, actor.sub);
}
function replaceFlightInstancesForDate(stationId, date, rows, actor) {
  return taskAllocationConfigRepo.replaceFlightInstancesForDate(stationId, dateOnly(date), rows, actor.sub);
}

// ─── Allocation Rules / Settings / Travel Time (Task Allocation Settings) ───
function listRules(stationId) { return taskAllocationConfigRepo.listRules(stationId, { includeDisabled: true }); }
function upsertRule(stationId, body, actor) {
  if (body.id) return taskAllocationConfigRepo.updateRule(body.id, { ...body, updatedById: actor.sub });
  return taskAllocationConfigRepo.createRule({ ...body, stationId, createdById: actor.sub, updatedById: actor.sub });
}
function deleteRule(id, actor) { return taskAllocationConfigRepo.deleteRule(id, actor.sub); }

function getSettings(stationId) { return taskAllocationConfigRepo.getSettings(stationId); }
function updateSettings(stationId, body, actor) { return taskAllocationConfigRepo.upsertSettings(stationId, body, actor.sub); }

function listTravelTimes(stationId) { return taskAllocationConfigRepo.listTravelTimes(stationId); }
function upsertTravelTime(stationId, body, actor) {
  return taskAllocationConfigRepo.upsertTravelTime(stationId, body.fromLocation, body.toLocation, body.minutes, actor.sub);
}
function deleteTravelTime(id) { return taskAllocationConfigRepo.deleteTravelTime(id); }

// ─── Task Generator (Section 7) ──────────────────────────────────────────────
function generateTasks(stationId, date, actor) {
  return taskGeneratorService.generateTasksForDate(stationId, date, actor.sub);
}

// ─── Task Board / Tasks / Unassigned (Sections 14-15) ───────────────────────
async function listTasks(stationId, filters) {
  const f = { ...filters };
  if (f.dateFrom) f.dateFrom = dateOnly(f.dateFrom);
  if (f.dateTo) f.dateTo = endOfDay(f.dateTo);
  const [tasks, nameMap] = await Promise.all([
    maintenanceTaskRepo.listTasks(stationId, f),
    readOnlyRosterAdapter.getStaffNameMap(stationId),
  ]);
  return attachAssignmentNames(tasks, nameMap);
}
async function getTask(stationId, id) {
  const task = await allocationEngineService.assertTaskBelongsToStation(id, stationId);
  const nameMap = await readOnlyRosterAdapter.getStaffNameMap(stationId);
  return attachAssignmentNames([task], nameMap)[0];
}
function listUnassignedTasks(stationId, dateFrom, dateTo) {
  return maintenanceTaskRepo.listUnassignedTasks(stationId, dateOnly(dateFrom), endOfDay(dateTo));
}
// Section 15's "Reason" block: WHY nothing is eligible — reuses the exact
// same eligibility results a would-be auto-allocation run would have seen.
async function explainUnassignedTask(stationId, id) {
  const task = await allocationEngineService.assertTaskBelongsToStation(id, stationId);
  const { isPublished, results } = await eligibilityEngineService.evaluateTask(stationId, task);
  return {
    task, isPublished,
    eligibleCount: results.filter(r => r.eligible).length,
    candidates: results.map(r => ({ userId: r.candidate.userId, fullName: r.candidate.fullName, eligible: r.eligible, failedReasons: r.failedReasons })),
  };
}
async function createManualTask(stationId, body, actor) {
  const existing = await maintenanceTaskRepo.listTasks(stationId, { dateFrom: dateOnly(body.plannedStart), dateTo: endOfDay(body.plannedStart) });
  const taskNumber = `T-${dateOnly(body.plannedStart).toISOString().slice(0, 10).replace(/-/g, "")}-${String(existing.length + 1).padStart(3, "0")}`;
  const task = await maintenanceTaskRepo.createTask({ ...body, stationId, taskNumber, source: "MANUAL", createdById: actor.sub, updatedById: actor.sub });
  await maintenanceTaskRepo.recordStatusChange(task.id, null, task.status || "UNASSIGNED", actor.sub, "Manually created");
  return task;
}
async function cancelTask(stationId, id, actor, reason) {
  const task = await allocationEngineService.assertTaskBelongsToStation(id, stationId);
  await manualAllocationService.unassignExisting(stationId, task, actor.sub, reason || "Task cancelled");
  await maintenanceTaskRepo.updateTask(id, { status: "CANCELLED" });
  await maintenanceTaskRepo.recordStatusChange(id, task.status, "CANCELLED", actor.sub, reason || null);
  return maintenanceTaskRepo.findTaskById(id);
}

// ─── Candidates / Eligibility (Sections 9, 17) ───────────────────────────────
async function getCandidates(stationId, taskId) {
  const task = await allocationEngineService.assertTaskBelongsToStation(taskId, stationId);
  return eligibilityEngineService.evaluateTask(stationId, task);
}

// ─── Allocation / Manual / Reallocation / What-If (Sections 13, 17, 19, 21) ─
function runAutoAllocation(stationId, body, actor) {
  return allocationEngineService.runAutoAllocation(stationId, body, actor);
}
function manualAssign(stationId, body, actor) {
  return manualAllocationService.manualAssign(stationId, body.taskId, body.userId, actor, { override: body.override, overrideReason: body.overrideReason });
}
function reallocateTask(stationId, taskId, actor, trigger, triggerDetail) {
  return reallocationService.reallocateTask(stationId, taskId, actor, trigger, triggerDetail);
}
async function runWhatIf(stationId, body, actor) {
  const [result, nameMap] = await Promise.all([
    reallocationService.runWhatIf(stationId, body, actor),
    readOnlyRosterAdapter.getStaffNameMap(stationId),
  ]);
  result.proposals.forEach(p => {
    p.previousUserName = nameMap[p.previousUserId] || null;
    p.proposedUserName = p.proposedUserId ? nameMap[p.proposedUserId] || null : null;
  });
  return result;
}
function commitWhatIf(stationId, runId, actor) {
  return reallocationService.commitWhatIf(stationId, runId, actor);
}

// ─── Conflicts (Section 12) ───────────────────────────────────────────────────
function listConflicts(stationId, filters) { return conflictDetectionService.listConflicts(stationId, filters); }
function detectConflicts(stationId, dateFrom, dateTo) { return conflictDetectionService.runConflictDetection(stationId, dateFrom, dateTo); }

// ─── Allocation History (Section 22) ─────────────────────────────────────────
async function listHistory(stationId, filters) {
  const f = { ...filters };
  if (f.dateFrom) f.dateFrom = dateOnly(f.dateFrom);
  if (f.dateTo) f.dateTo = endOfDay(f.dateTo);
  const [events, nameMap] = await Promise.all([
    maintenanceTaskRepo.listHistory(stationId, f),
    readOnlyRosterAdapter.getStaffNameMap(stationId),
  ]);
  return attachEventNames(events, nameMap);
}
function listRuns(stationId) { return maintenanceTaskRepo.listRuns(stationId); }
async function getRun(stationId, runId) {
  const run = await maintenanceTaskRepo.findRunById(runId);
  if (!run || run.stationId !== stationId) throw ApiError.notFound("Allocation run not found");
  return run;
}

module.exports = {
  getRosterSyncStatus, getAvailabilitySummary,
  listFlightInstances, upsertFlightInstance, deleteFlightInstance, replaceFlightInstancesForDate, syncFlightInstancesFromFlightSchedule,
  listRules, upsertRule, deleteRule,
  getSettings, updateSettings,
  listTravelTimes, upsertTravelTime, deleteTravelTime,
  generateTasks,
  listTasks, getTask, listUnassignedTasks, explainUnassignedTask, createManualTask, cancelTask,
  getCandidates,
  runAutoAllocation, manualAssign, reallocateTask, runWhatIf, commitWhatIf,
  listConflicts, detectConflicts,
  listHistory, listRuns, getRun,
};
