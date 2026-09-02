const prisma = require("../config/prisma");

// One row per (station, date, eventType, eventId) — matches the model's
// own unique constraint, so this doubles as the natural upsert key.
function listForDate(stationId, date) {
  return prisma.departureManpowerAssignment.findMany({
    where: { stationId, date },
    include: {
      releaser: { select: { id: true, fullName: true, category: true } },
      support: { select: { id: true, fullName: true, category: true } },
    },
  });
}

function upsert({ stationId, date, eventType, eventId, flightRef, releaserUserId, releaserCategory, supportUserId, actorId }) {
  return prisma.departureManpowerAssignment.upsert({
    where: { stationId_date_eventType_eventId: { stationId, date, eventType, eventId } },
    update: { flightRef, releaserUserId, releaserCategory, supportUserId, updatedById: actorId },
    create: { stationId, date, eventType, eventId, flightRef, releaserUserId, releaserCategory, supportUserId, createdById: actorId, updatedById: actorId },
    include: {
      releaser: { select: { id: true, fullName: true, category: true } },
      support: { select: { id: true, fullName: true, category: true } },
    },
  });
}

// Bulk auto-allocate writes as one transaction — either the whole day's
// allocation lands, or none of it does, so a partial failure can never
// leave the day half auto-filled and half untouched.
function bulkUpsert(rows) {
  return prisma.$transaction(
    rows.map(r => prisma.departureManpowerAssignment.upsert({
      where: { stationId_date_eventType_eventId: { stationId: r.stationId, date: r.date, eventType: r.eventType, eventId: r.eventId } },
      update: { flightRef: r.flightRef, releaserUserId: r.releaserUserId, releaserCategory: r.releaserCategory, supportUserId: r.supportUserId, updatedById: r.actorId },
      create: { stationId: r.stationId, date: r.date, eventType: r.eventType, eventId: r.eventId, flightRef: r.flightRef, releaserUserId: r.releaserUserId, releaserCategory: r.releaserCategory, supportUserId: r.supportUserId, createdById: r.actorId, updatedById: r.actorId },
    })),
  );
}

module.exports = { listForDate, upsert, bulkUpsert };
