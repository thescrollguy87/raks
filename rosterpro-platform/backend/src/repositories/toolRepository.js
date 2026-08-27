const prisma = require("../config/prisma");

function create(data) {
  return prisma.tool.create({ data });
}

function findById(id) {
  return prisma.tool.findUnique({ where: { id }, include: { issues: { where: { returnedAt: null } } } });
}

function updateStatus(id, status, calibrationDue) {
  return prisma.tool.update({
    where: { id },
    data: { status, ...(calibrationDue !== undefined ? { calibrationDue } : {}), version: { increment: 1 } },
  });
}

function listForStation(stationId) {
  return prisma.tool.findMany({
    where: { stationId, deletedAt: null },
    orderBy: { toolNo: "asc" },
    include: { issues: { where: { returnedAt: null }, include: { issuedTo: { select: { fullName: true } } } } },
  });
}

function listDueForCalibration(days) {
  const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return prisma.tool.findMany({
    where: { deletedAt: null, calibrationDue: { lte: cutoff } },
    orderBy: { calibrationDue: "asc" },
  });
}

function addCalibrationLog(data) {
  return prisma.toolCalibrationLog.create({ data });
}

function createIssue(data) {
  return prisma.toolIssue.create({ data });
}

function findOpenIssue(id) {
  return prisma.toolIssue.findUnique({ where: { id }, include: { tool: true } });
}

function returnIssue(id, actorId) {
  return prisma.toolIssue.update({ where: { id }, data: { returnedAt: new Date(), updatedById: actorId } });
}

function findOpenIssuesForTool(toolId) {
  return prisma.toolIssue.findMany({ where: { toolId, returnedAt: null } });
}

module.exports = {
  create, findById, updateStatus, listForStation, listDueForCalibration,
  addCalibrationLog, createIssue, findOpenIssue, returnIssue, findOpenIssuesForTool,
};
