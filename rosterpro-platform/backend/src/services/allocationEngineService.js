// TASK ALLOCATION MODULE — Auto Allocation Engine orchestration (Section
// 13). Deterministic: filters to hard-eligible candidates (never
// compensated by a score — Section 9's closing rule), ranks the survivors
// with taskAllocationEngine.scoreCandidate, and assigns the top-ranked one.
// No LLM involved anywhere in this decision (Section 31).
const taskAllocationConfigRepo = require("../repositories/taskAllocationConfigRepository");
const maintenanceTaskRepo = require("../repositories/maintenanceTaskRepository");
const eligibilityEngineService = require("./eligibilityEngineService");
const conflictDetectionService = require("./conflictDetectionService");
const { scoreCandidate, taskEnd: computeTaskEnd } = require("../utils/taskAllocationEngine");
const ApiError = require("../utils/ApiError");

function dateOnly(d) { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setUTCHours(23, 59, 59, 999); return x; }

function travelMinutesFromPrevious(task, candidate) {
  const lookup = candidate.travelTimeLookup;
  if (!lookup) return null;
  const last = (candidate.existingAssignments || [])
    .filter(a => new Date(a.taskEnd).getTime() <= new Date(task.plannedStart).getTime())
    .sort((a, b) => new Date(b.taskEnd) - new Date(a.taskEnd))[0];
  if (!last || !last.location || !task.location) return null;
  return lookup(last.location, task.location);
}

// Assigns ONE task to its single best eligible candidate, persisting the
// TaskAssignment + AllocationExplanation + every AllocationCandidate
// considered (eligible or not) + an AllocationEvent. Shared by auto
// allocation (this file) and manual/reallocation (which call it with a
// pre-chosen candidate override — see manualAllocationService.js).
async function assignTaskToCandidate(stationId, task, candidate, { runId, isManual, isOverride, assignedById, trigger, scoreInfo }) {
  const travelMinutes = travelMinutesFromPrevious(task, candidate);
  const workloadBeforePct = task.teamSize ? Math.round(clamp01((candidate.currentWorkloadMinutes || 0) / 480) * 100) : null;
  const projectedMinutes = (candidate.currentWorkloadMinutes || 0) + task.estimatedDurationMin;
  const workloadAfterPct = Math.round(clamp01(projectedMinutes / 480) * 100);

  const assignment = await maintenanceTaskRepo.createAssignment(
    {
      taskId: task.id, userId: candidate.userId, status: "ACTIVE",
      isManual: !!isManual, isOverride: !!isOverride,
      travelTimeMinutes: travelMinutes, workloadBeforePct, workloadAfterPct,
      runId: runId || null, assignedById: assignedById || null,
    },
    {
      checklist: candidate._checklist || [],
      travelTimeMinutes: travelMinutes, workloadBeforePct, workloadAfterPct,
      score: scoreInfo?.score ?? null, scoreBreakdown: scoreInfo?.breakdown ?? null,
    },
  );
  await maintenanceTaskRepo.updateTask(task.id, { status: "ASSIGNED" });
  await maintenanceTaskRepo.recordStatusChange(task.id, task.status, "ASSIGNED", assignedById, isManual ? "Manually assigned" : "Auto allocation");
  await maintenanceTaskRepo.createEvent({
    stationId, runId: runId || null, taskId: task.id, eventType: "ASSIGNED",
    previousUserId: null, newUserId: candidate.userId,
    reason: isOverride ? "Supervisor override" : (isManual ? "Manual assignment" : "Closest eligible candidate by score"),
    trigger: trigger || "MANUAL", actorId: assignedById || null, actorType: assignedById ? "USER" : "SYSTEM",
  });
  return assignment;
}
function clamp01(n) { return Math.max(0, Math.min(1, n)); }

// Section 13: "Run Auto Allocation" over a date range. Processes
// UNASSIGNED/READY tasks, most time-critical first (lowest priority number,
// then earliest deadline), so a tightly-constrained task isn't starved by a
// looser one claiming a candidate first.
async function runAutoAllocation(stationId, { dateFrom, dateTo, taskSource }, actor) {
  const from = dateOnly(dateFrom);
  const to = endOfDay(dateTo);

  const run = await maintenanceTaskRepo.createRun({
    stationId, runType: "AUTO_ALLOCATION", trigger: "MANUAL", triggerDetail: null,
    dateFrom: from, dateTo: to, taskSourceFilter: taskSource || null, startedById: actor?.sub || null,
  });

  const settings = await taskAllocationConfigRepo.getSettings(stationId);
  const weights = {
    deadline: settings.weightDeadline, workloadBalance: settings.weightWorkloadBalance, travelTime: settings.weightTravelTime,
    taskContinuity: settings.weightTaskContinuity, resourceUtilization: settings.weightResourceUtilization,
    idleTimeReduction: settings.weightIdleTimeReduction, fairness: settings.weightFairness,
  };

  let tasks = await maintenanceTaskRepo.listTasks(stationId, { dateFrom: from, dateTo: to });
  tasks = tasks.filter(t => (t.status === "UNASSIGNED" || t.status === "READY") && (!taskSource || t.source === taskSource));
  tasks.sort((a, b) => (a.priority - b.priority) || (new Date(a.deadline) - new Date(b.deadline)));

  let assigned = 0, unassigned = 0;
  for (const task of tasks) {
    const { isPublished, results } = await eligibilityEngineService.evaluateTask(stationId, task);
    if (!isPublished) { unassigned++; continue; }

    const scored = results.map(r => ({
      ...r,
      _score: r.eligible ? scoreCandidate(task, r.candidate, weights) : null,
    }));
    await maintenanceTaskRepo.createCandidates(scored.map((r, i) => ({
      runId: run.id, taskId: task.id, userId: r.candidate.userId,
      eligible: r.eligible, ineligibleReasons: r.eligible ? null : r.failedReasons,
      score: r._score?.score ?? null, scoreBreakdown: r._score?.breakdown ?? null, rank: null,
    })));

    const eligible = scored.filter(r => r.eligible).sort((a, b) => (b._score.score - a._score.score) || a.candidate.userId.localeCompare(b.candidate.userId));
    if (!eligible.length) { unassigned++; continue; }

    const winner = eligible[0];
    winner.candidate._checklist = winner.checklist;
    await assignTaskToCandidate(stationId, task, winner.candidate, {
      runId: run.id, isManual: false, isOverride: false, assignedById: null, trigger: "MANUAL", scoreInfo: winner._score,
    });
    assigned++;
  }

  const conflictResult = await conflictDetectionService.runConflictDetection(stationId, from, to);

  return maintenanceTaskRepo.completeRun(run.id, {
    tasksProcessed: tasks.length, tasksAssigned: assigned, tasksUnassigned: unassigned,
    conflictsCount: conflictResult.conflicts.filter(c => c.severity === "BLOCKING").length,
    warningsCount: conflictResult.conflicts.filter(c => c.severity === "WARNING").length,
  });
}

async function assertTaskBelongsToStation(taskId, stationId) {
  const task = await maintenanceTaskRepo.findTaskById(taskId);
  if (!task || task.stationId !== stationId) throw ApiError.notFound("Task not found");
  return task;
}

module.exports = { runAutoAllocation, assignTaskToCandidate, assertTaskBelongsToStation, travelMinutesFromPrevious };
