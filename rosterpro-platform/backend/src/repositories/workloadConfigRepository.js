const prisma = require("../config/prisma");

// ─── Station Workload Config (standard durations, ratios, buffers) ──────────
function getConfig(stationId) {
  return prisma.stationWorkloadConfig.findUnique({ where: { stationId } });
}

function upsertConfig({ stationId, actorId, ...fields }) {
  return prisma.stationWorkloadConfig.upsert({
    where: { stationId },
    update: { ...fields, updatedById: actorId },
    create: { stationId, ...fields, updatedById: actorId },
  });
}

// ─── Mandatory Minimum Coverage grid ─────────────────────────────────────────
function listMandatoryCoverageRules(stationId) {
  return prisma.mandatoryCoverageRule.findMany({ where: { stationId } });
}

function upsertMandatoryCoverageRule({ stationId, category, shift, enabled, minCount }) {
  return prisma.mandatoryCoverageRule.upsert({
    where: { stationId_category_shift: { stationId, category, shift } },
    update: { enabled, minCount },
    create: { stationId, category, shift, enabled, minCount },
  });
}

// ─── Planned Task Master ─────────────────────────────────────────────────────
function listPlannedTasks(stationId) {
  return prisma.plannedTaskMaster.findMany({ where: { stationId }, orderBy: { sortOrder: "asc" } });
}

function findPlannedTask(id) {
  return prisma.plannedTaskMaster.findUnique({ where: { id } });
}

function upsertPlannedTask({ id, stationId, ...fields }) {
  if (id) return prisma.plannedTaskMaster.update({ where: { id }, data: fields });
  return prisma.plannedTaskMaster.create({ data: { stationId, ...fields } });
}

function deletePlannedTask(id) {
  return prisma.plannedTaskMaster.delete({ where: { id } });
}

// ─── Unplanned Task Master ────────────────────────────────────────────────────
function listUnplannedTasks(stationId) {
  return prisma.unplannedTaskMaster.findMany({ where: { stationId }, orderBy: { sortOrder: "asc" } });
}

function findUnplannedTask(id) {
  return prisma.unplannedTaskMaster.findUnique({ where: { id } });
}

function upsertUnplannedTask({ id, stationId, ...fields }) {
  if (id) return prisma.unplannedTaskMaster.update({ where: { id }, data: fields });
  return prisma.unplannedTaskMaster.create({ data: { stationId, ...fields } });
}

function deleteUnplannedTask(id) {
  return prisma.unplannedTaskMaster.delete({ where: { id } });
}

// ─── Manual Demand ────────────────────────────────────────────────────────────
function listManualDemand(stationId, monthStart, monthEnd) {
  return prisma.manualDemand.findMany({
    where: { stationId, date: { gte: monthStart, lt: monthEnd } },
    orderBy: { date: "asc" },
  });
}

function findManualDemand(id) {
  return prisma.manualDemand.findUnique({ where: { id } });
}

function createManualDemand({ stationId, actorId, ...fields }) {
  return prisma.manualDemand.create({ data: { stationId, createdById: actorId, ...fields } });
}

function deleteManualDemand(id) {
  return prisma.manualDemand.delete({ where: { id } });
}

module.exports = {
  getConfig, upsertConfig,
  listMandatoryCoverageRules, upsertMandatoryCoverageRule,
  listPlannedTasks, findPlannedTask, upsertPlannedTask, deletePlannedTask,
  listUnplannedTasks, findUnplannedTask, upsertUnplannedTask, deleteUnplannedTask,
  listManualDemand, findManualDemand, createManualDemand, deleteManualDemand,
};
