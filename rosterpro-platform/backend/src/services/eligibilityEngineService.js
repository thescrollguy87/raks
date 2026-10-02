// TASK ALLOCATION MODULE — Eligibility Engine orchestration (Section 9).
// Gathers real candidate data (via the read-only Rostering adapter and this
// module's own repositories) into the plain-object shape
// taskAllocationEngine.checkEligibility expects, then runs it. All the
// actual constraint logic lives in that pure function — this file is purely
// data assembly.
const readOnlyRosterAdapter = require("./readOnlyRosterAdapter");
const maintenanceTaskRepo = require("../repositories/maintenanceTaskRepository");
const taskAllocationConfigRepo = require("../repositories/taskAllocationConfigRepository");
const { checkEligibility, taskEnd: computeTaskEnd } = require("../utils/taskAllocationEngine");

// Shift start/end are stored as plain "HH:MM" (same convention
// ShiftDefinition/ShiftAssignment already use) — combined here with the
// task's own calendar date using the SAME "wall-clock stamped as UTC"
// convention the rest of this app's date handling already relies on (see
// rosterGenerationService.js's dateAt()), so every Date object Task
// Allocation constructs stays internally consistent even though it isn't
// genuine UTC. An overnight Night shift (e.g. 21:00 -> 07:00) is detected
// by the end time naively landing before the start time and pushed a day
// forward.
function combineDateAndTime(dateBase, hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(dateBase.getUTCFullYear(), dateBase.getUTCMonth(), dateBase.getUTCDate(), h, m, 0, 0));
}
function shiftWindowForTaskDate(taskDate, shiftStartHHMM, shiftEndHHMM) {
  const start = combineDateAndTime(taskDate, shiftStartHHMM);
  let end = combineDateAndTime(taskDate, shiftEndHHMM);
  if (start && end && end.getTime() <= start.getTime()) end = new Date(end.getTime() + 24 * 60 * 60000);
  return { start, end };
}
function startOfDay(d) { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setUTCHours(23, 59, 59, 999); return x; }

// Everyone rostered for the task's date, enriched with leave/qualification/
// already-assigned-task data — the full candidate pool for one task, before
// any eligibility filtering. Returns isPublished=false (empty candidates)
// when there's no published roster for that date (Section 6: Task
// Allocation never has a staff source without one).
async function buildCandidatesForTask(stationId, task) {
  const taskDate = new Date(task.plannedStart);
  const { isPublished, staff } = await readOnlyRosterAdapter.getRosteredStaffForDate(stationId, taskDate);
  if (!isPublished || !staff.length) return { isPublished, candidates: [] };

  const userIds = staff.map(s => s.userId);
  const [leaveSet, travelTimes, existingAssignmentRows, profiles] = await Promise.all([
    readOnlyRosterAdapter.getLeaveSetForDate(userIds, taskDate),
    taskAllocationConfigRepo.listTravelTimes(stationId),
    maintenanceTaskRepo.listActiveAssignmentsForUsers(userIds, startOfDay(taskDate), endOfDay(taskDate)),
    Promise.all(userIds.map(id => readOnlyRosterAdapter.getQualificationProfile(id).then(p => [id, p]))),
  ]);
  const profileByUser = Object.fromEntries(profiles);
  const travelLookup = (from, to) => {
    const row = travelTimes.find(t => t.fromLocation === from && t.toLocation === to);
    return row ? row.minutes : null;
  };
  const assignmentsByUser = {};
  for (const a of existingAssignmentRows) {
    // Excludes the task we're actually evaluating — without this, the
    // person CURRENTLY assigned to `task` always sees it listed as one of
    // their own "existing assignments", which trivially "overlaps" itself
    // and would wrongly fail NO_OVERLAP/TRAVEL_TIME for the very person
    // who's already correctly doing it (e.g. when re-viewing candidates for
    // an already-assigned task in the Task Board's detail modal).
    if (a.taskId === task.id) continue;
    (assignmentsByUser[a.userId] ??= []).push({
      taskId: a.taskId, plannedStart: a.task.plannedStart, taskEnd: computeTaskEnd(a.task),
      location: a.task.location, aircraftRegistration: a.task.aircraftRegistration,
    });
  }

  const candidates = staff.map(s => {
    const { start, end } = shiftWindowForTaskDate(taskDate, s.shiftStart, s.shiftEnd);
    const profile = profileByUser[s.userId] || { qualifications: [], authorizations: [] };
    const myAssignments = assignmentsByUser[s.userId] || [];
    return {
      userId: s.userId, fullName: s.fullName, category: s.category, secondaryCategories: s.secondaryCategories,
      isActive: true, isRostered: true,
      onLeave: leaveSet.has(s.userId),
      trainingPending: !!s.trainingPending, unavailable: false,
      qualCodes: profile.qualifications.filter(q => q.status !== "EXPIRED").map(q => q.qualCode),
      authorizationScopes: profile.authorizations.filter(a => !a.expiryDate || new Date(a.expiryDate) >= taskDate).map(a => a.scope),
      shiftStart: start, shiftEnd: end,
      existingAssignments: myAssignments,
      travelTimeLookup: travelLookup,
      currentWorkloadMinutes: myAssignments.reduce((sum, a) => sum + (new Date(a.taskEnd).getTime() - new Date(a.plannedStart).getTime()) / 60000, 0),
      tasksAssignedToday: myAssignments.length,
    };
  });
  return { isPublished: true, candidates };
}

// Runs checkEligibility for every rostered candidate against one task —
// the "GET /candidates/:taskId" (Section 24) and Manual Allocation's own
// "eligible employees" list (Section 17) both use this directly.
async function evaluateTask(stationId, task) {
  const { isPublished, candidates } = await buildCandidatesForTask(stationId, task);
  const results = candidates.map(c => ({ candidate: c, ...checkEligibility(task, c) }));
  return { isPublished, results };
}

module.exports = { buildCandidatesForTask, evaluateTask, combineDateAndTime, shiftWindowForTaskDate };
