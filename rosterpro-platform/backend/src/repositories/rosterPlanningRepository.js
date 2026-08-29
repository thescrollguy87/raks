const prisma = require("../config/prisma");

// ─── Shift Patterns ───────────────────────────────────────────────────────────
function findPatternsForStation(stationId) {
  return prisma.shiftPattern.findMany({ where: { stationId, deletedAt: null }, orderBy: { code: "asc" } });
}

function findPatternById(id) {
  return prisma.shiftPattern.findUnique({ where: { id } });
}

// Creating (no id) with a code that collides with a SOFT-DELETED row would
// otherwise hit the (stationId, code) unique index and 409 — a soft delete
// doesn't free the code the way a real delete would. Un-deleting and
// overwriting that row instead means a deleted-then-recreated pattern code
// (a completely ordinary thing to do — delete "P1", add a new "P1") just
// works, the same as it would with no unique constraint in the way.
async function upsertPattern({ id, stationId, code, name, cycle, actorId }) {
  const data = { stationId, code, name, cycle, updatedById: actorId };
  if (id) return prisma.shiftPattern.update({ where: { id }, data });

  const existing = await prisma.shiftPattern.findUnique({ where: { stationId_code: { stationId, code } } });
  if (existing) {
    return prisma.shiftPattern.update({ where: { id: existing.id }, data: { ...data, deletedAt: null } });
  }
  return prisma.shiftPattern.create({ data: { ...data, createdById: actorId } });
}

function deletePattern(id) {
  return prisma.shiftPattern.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ─── Staff Allocation ─────────────────────────────────────────────────────────
// One row per staff member with an explicit pattern; a staff member with no
// row is MANUAL/no-pattern — the caller (staffAllocationService) merges this
// sparse set against the full active-staff list.
function findAllocationsForStation(stationId) {
  return prisma.staffShiftAllocation.findMany({
    where: { user: { stationId } },
    include: { pattern: { select: { id: true, code: true, name: true } } },
  });
}

function upsertAllocation({ userId, patternId, cycleStartDay, actorId }) {
  const data = { patternId, cycleStartDay, updatedById: actorId };
  return prisma.staffShiftAllocation.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}

// ─── Workload Items ───────────────────────────────────────────────────────────
function findWorkloadItemById(id) {
  return prisma.workloadItem.findUnique({ where: { id } });
}

function findWorkloadItemsForStation(stationId) {
  return prisma.workloadItem.findMany({
    where: { stationId, deletedAt: null },
    orderBy: [{ section: "asc" }, { sortOrder: "asc" }],
  });
}

function upsertWorkloadItem({ id, stationId, section, label, count, b1, b2, cm, ncs, actorId }) {
  const data = { stationId, section, label, count, b1, b2, cm, ncs, updatedById: actorId };
  if (id) return prisma.workloadItem.update({ where: { id }, data });
  return prisma.workloadItem.create({ data: { ...data, createdById: actorId } });
}

function deleteWorkloadItem(id) {
  return prisma.workloadItem.update({ where: { id }, data: { deletedAt: new Date() } });
}

module.exports = {
  findPatternsForStation, findPatternById, upsertPattern, deletePattern,
  findAllocationsForStation, upsertAllocation,
  findWorkloadItemById, findWorkloadItemsForStation, upsertWorkloadItem, deleteWorkloadItem,
};
