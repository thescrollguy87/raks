const prisma = require("../config/prisma");

function create({ stationId, name, latitude, longitude, radiusMeters, actorId }) {
  return prisma.officeLocation.create({
    data: {
      stationId, name, latitude, longitude,
      radiusMeters: radiusMeters ?? 200,
      createdById: actorId, updatedById: actorId,
    },
  });
}

function findById(id) {
  return prisma.officeLocation.findUnique({ where: { id } });
}

function update(id, { name, latitude, longitude, radiusMeters, isActive }, actorId) {
  return prisma.officeLocation.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
      ...(radiusMeters !== undefined ? { radiusMeters } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      updatedById: actorId,
    },
  });
}

function softDelete(id, actorId) {
  return prisma.officeLocation.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId } });
}

function list({ stationId, stationIdIn }) {
  return prisma.officeLocation.findMany({
    where: {
      deletedAt: null,
      ...(stationId ? { stationId } : {}),
      ...(stationIdIn ? { stationId: { in: stationIdIn } } : {}),
    },
    orderBy: { name: "asc" },
  });
}

// Lean, active-only fetch for the punch flow's distance calculation — no
// need for the fuller list() shape (which supports airline-wide callers)
// when all a punch ever needs is "every live geofence at MY station".
function listActiveForStation(stationId) {
  return prisma.officeLocation.findMany({
    where: { stationId, isActive: true, deletedAt: null },
  });
}

module.exports = { create, findById, update, softDelete, list, listActiveForStation };
