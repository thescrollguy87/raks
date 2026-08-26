const prisma = require("../config/prisma");

function createFlight(data) {
  return prisma.flight.create({ data });
}

function findFlightById(id) {
  return prisma.flight.findUnique({ where: { id }, include: { engineeringDelays: true, aircraft: true } });
}

function updateFlightStatus(id, data) {
  return prisma.flight.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
}

function listFlightsForStation(stationId, from, to) {
  return prisma.flight.findMany({
    where: {
      stationId, deletedAt: null,
      ...(from && to ? { scheduledIn: { gte: from, lte: to } } : {}),
    },
    orderBy: { scheduledIn: "asc" },
    include: { aircraft: { select: { registration: true, type: true } }, engineeringDelays: true },
  });
}

function createDelay(data) {
  return prisma.engineeringDelay.create({ data });
}

function listDelaysForStation(stationId, from, to) {
  return prisma.engineeringDelay.findMany({
    where: {
      deletedAt: null,
      flight: { stationId, ...(from && to ? { scheduledIn: { gte: from, lte: to } } : {}) },
    },
    include: { flight: { select: { flightNumber: true, scheduledIn: true } } },
    orderBy: { createdAt: "desc" },
  });
}

module.exports = { createFlight, findFlightById, updateFlightStatus, listFlightsForStation, createDelay, listDelaysForStation };
