// TASK ALLOCATION MODULE — Reallocation + What-If orchestration (Sections
// 19, 21). Reassesses only the AFFECTED tasks, never a full rebuild of the
// whole allocation — Section 19's own closing instruction.
const maintenanceTaskRepo = require("../repositories/maintenanceTaskRepository");
const taskAllocationConfigRepo = require("../repositories/taskAllocationConfigRepository");
const eligibilityEngineService = require("./eligibilityEngineService");
const allocationEngineService = require("./allocationEngineService");
const manualAllocationService = require("./manualAllocationService");
const { scoreCandidate } = require("../utils/taskAllocationEngine");
const ApiError = require("../utils/ApiError");

function dateOnly(d) { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setUTCHours(23, 59, 59, 999); return x; }

async function weightsFor(stationId) {
  const s = await taskAllocationConfigRepo.getSettings(stationId);
  return {
    deadline: s.weightDeadline, workloadBalance: s.weightWorkloadBalance, travelTime: s.weightTravelTime,
    taskContinuity: s.weightTaskContinuity, resourceUtilization: s.weightResourceUtilization,
    idleTimeReduction: s.weightIdleTimeReduction, fairness: s.weightFairness,
  };
}

// Re-evaluates ONE already-affected task and either assigns the best
// remaining eligible candidate or leaves it (honestly) unassigned. Shared
// by reallocateTask (one specific task) and the what-if simulation's
// per-task recompute (Section 19/21).
async function reassignOneTask(stationId, task, { runId, excludeUserId, trigger, actorId, triggerDetail } = {}) {
  const weights = await weightsFor(stationId);
  const { isPublished, results } = await eligibilityEngineService.evaluateTask(stationId, task);
  if (!isPublished) return { assignedTo: null, reason: "No published roster for this date" };

  const pool = excludeUserId ? results.filter(r => r.candidate.userId !== excludeUserId) : results;
  const scored = pool.map(r => ({ ...r, _score: r.eligible ? scoreCandidate(task, r.candidate, weights) : null }));

  if (runId) {
    await maintenanceTaskRepo.createCandidates(scored.map(r => ({
      runId, taskId: task.id, userId: r.candidate.userId,
      eligible: r.eligible, ineligibleReasons: r.eligible ? null : r.failedReasons,
      score: r._score?.score ?? null, scoreBreakdown: r._score?.breakdown ?? null, rank: null,
    })));
  }

  const eligible = scored.filter(r => r.eligible).sort((a, b) => (b._score.score - a._score.score) || a.candidate.userId.localeCompare(b.candidate.userId));
  if (!eligible.length) return { assignedTo: null, reason: "No eligible candidate remains" };

  const winner = eligible[0];
  winner.candidate._checklist = winner.checklist;
  return { assignedTo: winner.candidate.userId, score: winner._score, candidate: winner.candidate };
}

// Section 19: a trigger event affects a known set of tasks — reassign just
// those, leaving every other task's assignment untouched.
async function reallocateTask(stationId, taskId, actor, trigger, triggerDetail) {
  const task = await allocationEngineService.assertTaskBelongsToStation(taskId, stationId);
  const run = await maintenanceTaskRepo.createRun({
    stationId, runType: "REALLOCATION", trigger: trigger || "MANUAL", triggerDetail: triggerDetail || null,
    dateFrom: dateOnly(task.plannedStart), dateTo: endOfDay(task.plannedStart), startedById: actor.sub,
  });

  await manualAllocationService.unassignExisting(stationId, task, actor.sub, triggerDetail || "Reallocation");
  const result = await reassignOneTask(stationId, task, { runId: run.id, trigger, actorId: actor.sub });

  if (result.assignedTo) {
    await allocationEngineService.assignTaskToCandidate(stationId, task, result.candidate, {
      runId: run.id, isManual: false, isOverride: false, assignedById: null, trigger: trigger || "MANUAL", scoreInfo: result.score,
    });
  }
  return maintenanceTaskRepo.completeRun(run.id, {
    tasksProcessed: 1, tasksAssigned: result.assignedTo ? 1 : 0, tasksUnassigned: result.assignedTo ? 0 : 1,
    conflictsCount: 0, warningsCount: 0,
  });
}

// Section 21: "what if AME-001 becomes unavailable" — recomputes every task
// currently assigned to `userId` on `date` AS IF they were excluded,
// WITHOUT touching any real TaskAssignment or MaintenanceTask row. Stored
// as an uncommitted AllocationRun (isCommitted=false) purely for review;
// commitWhatIf below is the only path that ever makes it real.
async function runWhatIf(stationId, { userId, date, reason }, actor) {
  const from = dateOnly(date), to = endOfDay(date);
  const affected = await maintenanceTaskRepo.listActiveAssignmentsForUsers([userId], from, to);

  const run = await maintenanceTaskRepo.createRun({
    stationId, runType: "WHAT_IF", trigger: "STAFF_UNAVAILABLE", triggerDetail: reason || `What-if: ${userId} unavailable`,
    dateFrom: from, dateTo: to, startedById: actor.sub, isCommitted: false,
  });

  const proposals = [];
  for (const a of affected) {
    const result = await reassignOneTask(stationId, a.task, { runId: run.id, excludeUserId: userId });
    proposals.push({ taskId: a.task.id, taskNumber: a.task.taskNumber, previousUserId: userId, proposedUserId: result.assignedTo, reason: result.reason || null });
  }

  await maintenanceTaskRepo.completeRun(run.id, {
    tasksProcessed: affected.length, tasksAssigned: proposals.filter(p => p.proposedUserId).length,
    tasksUnassigned: proposals.filter(p => !p.proposedUserId).length, conflictsCount: 0, warningsCount: 0,
  });

  return { runId: run.id, affectedTaskCount: affected.length, proposals };
}

// Confirms a previously-computed What-If run: applies each proposal for
// real (reassigns or leaves unassigned, exactly as the simulation
// predicted) — the explicit "supervisor confirms" step Section 21 requires
// before anything commits.
async function commitWhatIf(stationId, runId, actor) {
  const run = await maintenanceTaskRepo.findRunById(runId);
  if (!run || run.stationId !== stationId) throw ApiError.notFound("What-if run not found");
  if (run.runType !== "WHAT_IF") throw ApiError.badRequest("Only a what-if run can be committed");

  const byTask = {};
  for (const c of run.candidates) (byTask[c.taskId] ??= []).push(c);

  let applied = 0;
  for (const [taskId, candidates] of Object.entries(byTask)) {
    const best = candidates.filter(c => c.eligible).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    if (!best) continue;
    const task = await allocationEngineService.assertTaskBelongsToStation(taskId, stationId);
    await manualAllocationService.unassignExisting(stationId, task, actor.sub, "Committed from what-if simulation");
    await allocationEngineService.assignTaskToCandidate(stationId, task, { userId: best.userId, _checklist: [], existingAssignments: [] }, {
      runId: run.id, isManual: true, isOverride: false, assignedById: actor.sub, trigger: "MANUAL",
      scoreInfo: { score: best.score, breakdown: best.scoreBreakdown },
    });
    applied++;
  }
  await maintenanceTaskRepo.completeRun(run.id, { isCommitted: true });
  return { committed: applied };
}

module.exports = { reallocateTask, runWhatIf, commitWhatIf };
