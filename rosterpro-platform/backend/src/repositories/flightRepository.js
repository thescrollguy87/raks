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

// Every flight touching one calendar date at a station — arriving,
// departing, or both. Unlike listFlightsForStation (which filters on
// scheduledIn alone, fine for "today's flights" display purposes),
// scheduledIn and scheduledOut can each independently be null (an import
// row needs only one of Arrival/Departure), so an outbound-only flight from
// the home base would be silently missed by a scheduledIn-only filter —
// this ORs both legs instead. Used by the Task Allocation module's
// read-only Flight Instance sync.
function listFlightsForStationByDate(stationId, dayStart, dayEnd) {
  return prisma.flight.findMany({
    where: {
      stationId, deletedAt: null,
      OR: [{ scheduledIn: { gte: dayStart, lte: dayEnd } }, { scheduledOut: { gte: dayStart, lte: dayEnd } }],
    },
    orderBy: [{ scheduledOut: "asc" }, { scheduledIn: "asc" }],
    include: { aircraft: { select: { registration: true, type: true } } },
  });
}

// Existing flights for one flight number at one station within a date
// range — used by the schedule importer to decide create-vs-update per
// date instead of blindly inserting a duplicate on every re-run.
function findFlightsByNumberInRange(stationId, flightNumber, rangeStart, rangeEnd) {
  return prisma.flight.findMany({
    where: {
      stationId, flightNumber, deletedAt: null,
      OR: [
        { scheduledIn: { gte: rangeStart, lt: rangeEnd } },
        { scheduledOut: { gte: rangeStart, lt: rangeEnd } },
      ],
    },
  });
}

function updateFlightSchedule(id, data) {
  return prisma.flight.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
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

module.exports = {
  createFlight, findFlightById, updateFlightStatus, listFlightsForStation, listFlightsForStationByDate, createDelay, listDelaysForStation,
  findFlightsByNumberInRange, updateFlightSchedule,
};
