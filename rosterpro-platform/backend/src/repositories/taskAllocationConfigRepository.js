// TASK ALLOCATION MODULE — isolated repository. Every table queried here
// (task_allocation_flight_instances, allocation_rules, allocation_settings,
// travel_time_matrix) was added by the Task Allocation migration; nothing
// here touches a Rostering table. See schema.prisma's module banner.
const prisma = require("../config/prisma");

// ─── Flight Instances (Section 6's daily real-flight input) ─────────────────
function listFlightInstances(stationId, dateFrom, dateTo) {
  return prisma.taskAllocationFlightInstance.findMany({
    where: { stationId, deletedAt: null, flightDate: { gte: dateFrom, lte: dateTo } },
    orderBy: [{ flightDate: "asc" }, { flightNumber: "asc" }],
  });
}
function findFlightInstanceById(id) {
  return prisma.taskAllocationFlightInstance.findUnique({ where: { id } });
}
function createFlightInstance(data) {
  return prisma.taskAllocationFlightInstance.create({ data });
}
function updateFlightInstance(id, data) {
  return prisma.taskAllocationFlightInstance.update({ where: { id }, data });
}
function deleteFlightInstance(id, actorId) {
  return prisma.taskAllocationFlightInstance.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId } });
}
// Bulk CSV/manual import for one day (Section 6's "entered/imported
// daily"). Re-importing a date is a full REPLACE for that date (soft-delete
// whatever was there, insert the new rows) rather than a field-by-field
// upsert — there's no natural unique key for one flight instance (a station
// can legitimately run the same flight number twice a day on a
// charter-heavy day), and "replace today's list" is the realistic workflow
// for a daily operational import. Any MaintenanceTask already generated
// from a replaced row keeps its own flightNumber/aircraftRegistration
// snapshot (denormalized on MaintenanceTask itself), so this never silently
// invalidates already-generated or already-assigned tasks.
async function replaceFlightInstancesForDate(stationId, flightDate, rows, actorId) {
  return prisma.$transaction([
    prisma.taskAllocationFlightInstance.updateMany({
      where: { stationId, flightDate, deletedAt: null },
      data: { deletedAt: new Date(), updatedById: actorId },
    }),
    prisma.taskAllocationFlightInstance.createMany({
      data: rows.map(r => ({ ...r, stationId, flightDate, createdById: actorId, updatedById: actorId })),
    }),
  ]);
}

// ─── Allocation Rules (Section 7/8 — Task Generator config) ─────────────────
function listRules(stationId, { includeDisabled = false } = {}) {
  return prisma.allocationRule.findMany({
    where: { stationId, deletedAt: null, ...(includeDisabled ? {} : { isEnabled: true }) },
    orderBy: { ruleName: "asc" },
  });
}
function findRuleById(id) {
  return prisma.allocationRule.findUnique({ where: { id } });
}
function createRule(data) {
  return prisma.allocationRule.create({ data });
}
function updateRule(id, data) {
  return prisma.allocationRule.update({ where: { id }, data });
}
function deleteRule(id, actorId) {
  return prisma.allocationRule.update({ where: { id }, data: { deletedAt: new Date(), isEnabled: false, updatedById: actorId } });
}

// ─── Allocation Settings (Section 10/27 — optimizer weights + refresh) ──────
async function getSettings(stationId) {
  const existing = await prisma.allocationSettings.findUnique({ where: { stationId } });
  if (existing) return existing;
  // A station with no row yet gets the documented defaults (Section 10) —
  // created lazily on first read rather than requiring a seed step.
  return prisma.allocationSettings.create({ data: { stationId } });
}
function upsertSettings(stationId, data, actorId) {
  return prisma.allocationSettings.upsert({
    where: { stationId },
    update: { ...data, updatedById: actorId },
    create: { stationId, ...data, updatedById: actorId },
  });
}

// ─── Travel Time Matrix (Section 11) ─────────────────────────────────────────
function listTravelTimes(stationId) {
  return prisma.travelTimeMatrix.findMany({ where: { stationId }, orderBy: [{ fromLocation: "asc" }, { toLocation: "asc" }] });
}
function upsertTravelTime(stationId, fromLocation, toLocation, minutes, actorId) {
  return prisma.travelTimeMatrix.upsert({
    where: { stationId_fromLocation_toLocation: { stationId, fromLocation, toLocation } },
    update: { minutes, updatedById: actorId },
    create: { stationId, fromLocation, toLocation, minutes, createdById: actorId, updatedById: actorId },
  });
}
function deleteTravelTime(id) {
  return prisma.travelTimeMatrix.delete({ where: { id } });
}

module.exports = {
  listFlightInstances, findFlightInstanceById, createFlightInstance, updateFlightInstance, deleteFlightInstance, replaceFlightInstancesForDate,
  listRules, findRuleById, createRule, updateRule, deleteRule,
  getSettings, upsertSettings,
  listTravelTimes, upsertTravelTime, deleteTravelTime,
};
