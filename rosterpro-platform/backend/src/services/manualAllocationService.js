// TASK ALLOCATION MODULE — Manual Allocation + Override orchestration
// (Sections 17-18). A supervisor picks from the Eligibility Engine's own
// candidate list — never a fabricated "it worked" when a hard constraint
// actually fails; that requires an explicit, reasoned override instead.
const maintenanceTaskRepo = require("../repositories/maintenanceTaskRepository");
const eligibilityEngineService = require("./eligibilityEngineService");
const allocationEngineService = require("./allocationEngineService");
const ApiError = require("../utils/ApiError");

async function unassignExisting(stationId, task, actorId, reason) {
  const existing = await maintenanceTaskRepo.findActiveAssignment(task.id);
  if (!existing) return null;
  await maintenanceTaskRepo.markAssignmentReassigned(existing.id);
  await maintenanceTaskRepo.createEvent({
    stationId, taskId: task.id, eventType: "REASSIGNED",
    previousUserId: existing.userId, newUserId: null, reason: reason || "Reassigned", actorId, actorType: actorId ? "USER" : "SYSTEM",
  });
  return existing;
}

// Section 17: supervisor selects Task -> Eligible Employees -> Employee ->
// Confirm. A candidate who fails a hard constraint is refused UNLESS
// `override` is explicitly set, which requires a reason (Section 18) and
// is recorded as its own OVERRIDE event, never silently folded into a plain
// ASSIGNED one.
async function manualAssign(stationId, taskId, userId, actor, { override = false, overrideReason } = {}) {
  const task = await allocationEngineService.assertTaskBelongsToStation(taskId, stationId);
  if (override && !overrideReason) throw ApiError.badRequest("A reason is required to override a hard-constraint violation");

  const { isPublished, results } = await eligibilityEngineService.evaluateTask(stationId, task);
  if (!isPublished) throw ApiError.badRequest("No published roster exists for this task's date — nobody can be assigned to it yet");

  const match = results.find(r => r.candidate.userId === userId);
  if (!match) throw ApiError.badRequest("That employee is not rostered on duty for this task's date");

  if (!match.eligible && !override) {
    throw ApiError.badRequest(`Assignment not permitted: ${match.failedReasons.join("; ")}`);
  }

  await unassignExisting(stationId, task, actor.sub, "Reassigned via manual assignment");
  match.candidate._checklist = match.checklist;

  const assignment = await allocationEngineService.assignTaskToCandidate(stationId, task, match.candidate, {
    runId: null, isManual: true, isOverride: !match.eligible, assignedById: actor.sub, trigger: "MANUAL", scoreInfo: null,
  });

  if (!match.eligible) {
    // The ASSIGNED event assignTaskToCandidate already wrote is kept (it's
    // the literal "who is now assigned" fact); this second OVERRIDE event
    // carries the reason/actor/timestamp Section 18 explicitly requires,
    // without which an override would look identical to a clean assignment.
    await maintenanceTaskRepo.createEvent({
      stationId, taskId: task.id, eventType: "OVERRIDE",
      previousUserId: null, newUserId: userId, reason: overrideReason,
      actorId: actor.sub, actorType: "USER",
      metadata: { failedReasons: match.failedReasons },
    });
  }

  return { assignment, eligible: match.eligible, failedReasons: match.eligible ? [] : match.failedReasons };
}

module.exports = { manualAssign, unassignExisting };
