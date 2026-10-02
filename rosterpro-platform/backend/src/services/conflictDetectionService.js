// TASK ALLOCATION MODULE — Conflict Detection orchestration (Section 12).
// Gathers real data (active assignments, tasks, travel matrix) into the
// shape taskAllocationEngine.detectConflicts expects, persists what it
// finds, and resolves conflicts for tasks that no longer have them.
const maintenanceTaskRepo = require("../repositories/maintenanceTaskRepository");
const taskAllocationConfigRepo = require("../repositories/taskAllocationConfigRepository");
const { detectConflicts, taskEnd: computeTaskEnd } = require("../utils/taskAllocationEngine");

function dateOnly(d) { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setUTCHours(23, 59, 59, 999); return x; }

// Re-scans every task in [dateFrom, dateTo] for the station and replaces
// the open conflict list with whatever's genuinely true right now — called
// after Auto Allocation, after a manual assignment, or on demand from the
// Conflicts page's own refresh.
async function runConflictDetection(stationId, dateFrom, dateTo) {
  const from = dateOnly(dateFrom);
  const to = endOfDay(dateTo);

  const [tasks, travelTimes] = await Promise.all([
    maintenanceTaskRepo.listTasks(stationId, { dateFrom: from, dateTo: to }),
    taskAllocationConfigRepo.listTravelTimes(stationId),
  ]);
  const travelLookup = (fromLoc, toLoc) => {
    const row = travelTimes.find(t => t.fromLocation === fromLoc && t.toLocation === toLoc);
    return row ? row.minutes : null;
  };

  const assignmentsByUser = {};
  for (const t of tasks) {
    for (const a of t.assignments || []) {
      if (a.status !== "ACTIVE") continue;
      (assignmentsByUser[a.userId] ??= []).push({ taskId: t.id, plannedStart: t.plannedStart, taskEnd: computeTaskEnd(t), location: t.location });
    }
  }

  const found = detectConflicts({ tasks, assignmentsByUser, travelTimeLookup: travelLookup });

  const taskIdsInScope = tasks.map(t => t.id);
  for (const taskId of taskIdsInScope) await maintenanceTaskRepo.resolveConflictsForTask(taskId);
  await maintenanceTaskRepo.createConflicts(found.map(c => ({ ...c, stationId })));

  return { conflictsFound: found.length, tasksScanned: tasks.length, conflicts: found };
}

function listConflicts(stationId, filters) {
  return maintenanceTaskRepo.listConflicts(stationId, filters);
}

module.exports = { runConflictDetection, listConflicts };
