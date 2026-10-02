// TASK ALLOCATION MODULE — isolated repository for the operational tables
// (maintenance_tasks, task_assignments, allocation_runs, allocation_
// candidates, allocation_events, task_conflicts, task_status_history). See
// schema.prisma's module banner for the isolation rationale.
const prisma = require("../config/prisma");

// ─── Maintenance Tasks ────────────────────────────────────────────────────────
function listTasks(stationId, filters = {}) {
  const { dateFrom, dateTo, status, taskType, aircraftRegistration, requiredCategory, userId } = filters;
  return prisma.maintenanceTask.findMany({
    where: {
      stationId, deletedAt: null,
      ...(dateFrom && dateTo ? { plannedStart: { gte: dateFrom, lte: dateTo } } : {}),
      ...(status ? { status } : {}),
      ...(taskType ? { taskType } : {}),
      ...(aircraftRegistration ? { aircraftRegistration } : {}),
      ...(requiredCategory ? { requiredCategory } : {}),
      ...(userId ? { assignments: { some: { userId, status: "ACTIVE" } } } : {}),
    },
    include: { assignments: { where: { status: "ACTIVE" }, include: { explanation: true } } },
    orderBy: { plannedStart: "asc" },
  });
}
function findTaskById(id) {
  return prisma.maintenanceTask.findUnique({
    where: { id },
    include: {
      assignments: { include: { explanation: true } },
      conflicts: { where: { isResolved: false } },
      statusHistory: { orderBy: { changedAt: "desc" } },
    },
  });
}
function createTask(data) {
  return prisma.maintenanceTask.create({ data });
}
function createTasks(rows) {
  return prisma.maintenanceTask.createMany({ data: rows });
}
function updateTask(id, data) {
  return prisma.maintenanceTask.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
}
function deleteTask(id, actorId) {
  return prisma.maintenanceTask.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId } });
}
function listUnassignedTasks(stationId, dateFrom, dateTo) {
  return prisma.maintenanceTask.findMany({
    where: { stationId, deletedAt: null, status: "UNASSIGNED", plannedStart: { gte: dateFrom, lte: dateTo } },
    orderBy: { plannedStart: "asc" },
  });
}

// ─── Task Status History ─────────────────────────────────────────────────────
function recordStatusChange(taskId, fromStatus, toStatus, changedById, reason) {
  return prisma.taskStatusHistory.create({ data: { taskId, fromStatus, toStatus, changedById, reason } });
}

// ─── Task Assignments ─────────────────────────────────────────────────────────
function findActiveAssignment(taskId) {
  return prisma.taskAssignment.findFirst({ where: { taskId, status: "ACTIVE" }, include: { explanation: true } });
}
// Every ACTIVE assignment for a set of staff within a date window — the
// Eligibility Engine's "does this candidate already have an impossible
// overlapping task" check (Section 9.9) reads this.
function listActiveAssignmentsForUsers(userIds, dateFrom, dateTo) {
  return prisma.taskAssignment.findMany({
    where: {
      userId: { in: userIds }, status: "ACTIVE",
      task: { deletedAt: null, plannedStart: { lte: dateTo }, deadline: { gte: dateFrom } },
    },
    include: { task: true },
  });
}
async function createAssignment(data, explanation) {
  return prisma.taskAssignment.create({
    data: { ...data, ...(explanation ? { explanation: { create: explanation } } : {}) },
    include: { explanation: true },
  });
}
function markAssignmentReassigned(id) {
  return prisma.taskAssignment.update({ where: { id }, data: { status: "REASSIGNED" } });
}
function markAssignmentCancelled(id) {
  return prisma.taskAssignment.update({ where: { id }, data: { status: "CANCELLED" } });
}

// ─── Allocation Runs / Candidates / Events (Section 22 — audit history) ─────
function createRun(data) {
  return prisma.allocationRun.create({ data });
}
function completeRun(id, summary) {
  return prisma.allocationRun.update({ where: { id }, data: { ...summary, completedAt: new Date() } });
}
function createCandidates(rows) {
  if (!rows.length) return Promise.resolve({ count: 0 });
  return prisma.allocationCandidate.createMany({ data: rows });
}
function listCandidatesForTask(runId, taskId) {
  return prisma.allocationCandidate.findMany({ where: { runId, taskId }, orderBy: [{ eligible: "desc" }, { rank: "asc" }] });
}
function createEvent(data) {
  return prisma.allocationEvent.create({ data });
}
function listHistory(stationId, { dateFrom, dateTo, taskId, limit = 200 } = {}) {
  return prisma.allocationEvent.findMany({
    where: {
      stationId,
      ...(taskId ? { taskId } : {}),
      ...(dateFrom && dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
function listRuns(stationId, limit = 50) {
  return prisma.allocationRun.findMany({ where: { stationId }, orderBy: { startedAt: "desc" }, take: limit });
}
function findRunById(id) {
  return prisma.allocationRun.findUnique({ where: { id }, include: { candidates: true, events: true } });
}

// ─── Task Conflicts (Section 12) ─────────────────────────────────────────────
function listConflicts(stationId, { resolved = false, dateFrom, dateTo } = {}) {
  return prisma.taskConflict.findMany({
    where: {
      stationId, isResolved: resolved,
      ...(dateFrom && dateTo ? { task: { plannedStart: { gte: dateFrom, lte: dateTo } } } : {}),
    },
    include: { task: true },
    orderBy: { detectedAt: "desc" },
  });
}
function createConflicts(rows) {
  if (!rows.length) return Promise.resolve({ count: 0 });
  return prisma.taskConflict.createMany({ data: rows });
}
function resolveConflictsForTask(taskId) {
  return prisma.taskConflict.updateMany({ where: { taskId, isResolved: false }, data: { isResolved: true, resolvedAt: new Date() } });
}

module.exports = {
  listTasks, findTaskById, createTask, createTasks, updateTask, deleteTask, listUnassignedTasks,
  recordStatusChange,
  findActiveAssignment, listActiveAssignmentsForUsers, createAssignment, markAssignmentReassigned, markAssignmentCancelled,
  createRun, completeRun, createCandidates, listCandidatesForTask, createEvent, listHistory, listRuns, findRunById,
  listConflicts, createConflicts, resolveConflictsForTask,
};
