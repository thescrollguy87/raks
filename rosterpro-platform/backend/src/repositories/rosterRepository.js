const prisma = require("../config/prisma");

function findRosterByStationAndMonth(stationId, monthKey) {
  return prisma.roster.findUnique({ where: { stationId_monthKey: { stationId, monthKey } } });
}

// Archive listing — every roster ever created for a station, most recent
// first, with a staff/shift count so the archive view doesn't need a
// second round-trip per row just to show "how big was this roster".
async function listRostersForStation(stationId) {
  const rosters = await prisma.roster.findMany({
    where: { stationId, deletedAt: null },
    orderBy: { monthKey: "desc" },
  });
  const counts = await prisma.shiftAssignment.groupBy({
    by: ["rosterId"],
    where: { rosterId: { in: rosters.map(r => r.id) }, deletedAt: null },
    _count: true,
  });
  const countByRoster = Object.fromEntries(counts.map(c => [c.rosterId, c._count]));
  return rosters.map(r => ({ ...r, shiftAssignmentCount: countByRoster[r.id] || 0 }));
}

function findRosterById(id) {
  return prisma.roster.findUnique({ where: { id } });
}

function createRoster(stationId, monthKey, actorId) {
  return prisma.roster.create({
    data: { stationId, monthKey, createdById: actorId, updatedById: actorId },
  });
}

function publishRoster(id, actorId) {
  return prisma.roster.update({
    where: { id },
    data: { isPublished: true, publishedAt: new Date(), publishedById: actorId, version: { increment: 1 } },
  });
}

function unpublishRoster(id, actorId) {
  return prisma.roster.update({
    where: { id },
    data: { isPublished: false, publishedAt: null, publishedById: null, version: { increment: 1 } },
  });
}

// Full grid for a roster: every active staff member at the station × their
// shift assignments for that roster, shaped so the frontend can render the
// same staff-rows × day-columns table the prototype already uses.
function getRosterGrid(stationId, rosterId) {
  return prisma.user.findMany({
    where: { stationId, isActive: true, deletedAt: null },
    orderBy: { fullName: "asc" },
    select: {
      id: true, fullName: true, category: true, designation: true,
      shiftAssignments: {
        where: { rosterId, deletedAt: null },
        select: { shiftDate: true, shiftDefId: true, shiftDef: { select: { code: true, name: true, color: true, type: true } }, note: true },
      },
    },
  });
}

// Contact info (id/email/phone/fullName) for everyone a roster-wide
// notification (published/unpublished) should reach — every active staff
// member at the station, regardless of whether they have shifts assigned
// yet in this particular roster.
function getActiveStaffContacts(stationId) {
  return prisma.user.findMany({
    where: { stationId, isActive: true, deletedAt: null },
    select: { id: true, fullName: true, email: true, phone: true },
  });
}

// Same as above plus category — the roster generator needs to know who's
// B1/B2/CM/NCS/STO to enforce the minimum-coverage rule; the contacts-only
// version above stays lean for the notification call sites that don't.
function getActiveStaffForGeneration(stationId) {
  return prisma.user.findMany({
    where: { stationId, isActive: true, deletedAt: null },
    select: { id: true, fullName: true, category: true },
    orderBy: { fullName: "asc" },
  });
}

function findStationById(stationId) {
  return prisma.station.findUnique({ where: { id: stationId }, select: { name: true, iataCode: true } });
}

function findShiftDefByCode(code) {
  return prisma.shiftDefinition.findUnique({ where: { code } });
}

function findShiftDefById(id) {
  return prisma.shiftDefinition.findUnique({ where: { id } });
}

// Feeds the daily shift-reminder job: every on-duty (not off/leave) shift
// assignment for the given date, on a PUBLISHED roster only — deliberately
// excludes draft rosters so nobody gets reminded about a shift that might
// still change before it's confirmed.
function findShiftsForDate(dateObj) {
  return prisma.shiftAssignment.findMany({
    where: {
      shiftDate: dateObj,
      deletedAt: null,
      roster: { isPublished: true },
      shiftDef: { type: { in: ["duty", "night"] } },
    },
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true, isActive: true } },
      shiftDef: { select: { code: true, name: true, startTime: true, endTime: true } },
    },
  });
}

function findAllShiftDefs() {
  return prisma.shiftDefinition.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });
}

function findAssignment(rosterId, userId, shiftDate) {
  return prisma.shiftAssignment.findUnique({
    where: { rosterId_userId_shiftDate: { rosterId, userId, shiftDate } },
  });
}

// Upsert keyed on the (rosterId, userId, shiftDate) unique constraint —
// mirrors the "one cell in the roster grid" concept from the prototype.
function upsertAssignment({ rosterId, userId, shiftDate, shiftDefId, note, actorId }) {
  return prisma.shiftAssignment.upsert({
    where: { rosterId_userId_shiftDate: { rosterId, userId, shiftDate } },
    update: { shiftDefId, note: note || null, updatedById: actorId, version: { increment: 1 } },
    create: { rosterId, userId, shiftDate, shiftDefId, note: note || null, createdById: actorId, updatedById: actorId },
  });
}

function bulkUpsertAssignments(rows) {
  // Prisma has no native bulk-upsert, so this runs as one transaction of
  // individual upserts — still a single round-trip commit, and small enough
  // (capped at 2000 rows by the validator) not to need a raw-SQL alternative.
  return prisma.$transaction(rows.map(r => prisma.shiftAssignment.upsert({
    where: { rosterId_userId_shiftDate: { rosterId: r.rosterId, userId: r.userId, shiftDate: r.shiftDate } },
    update: { shiftDefId: r.shiftDefId, note: r.note || null, updatedById: r.actorId, version: { increment: 1 } },
    create: { rosterId: r.rosterId, userId: r.userId, shiftDate: r.shiftDate, shiftDefId: r.shiftDefId, note: r.note || null, createdById: r.actorId, updatedById: r.actorId },
  })));
}

module.exports = {
  findRosterByStationAndMonth, findRosterById, createRoster, publishRoster, unpublishRoster, getRosterGrid,
  listRostersForStation,
  getActiveStaffContacts, getActiveStaffForGeneration, findStationById,
  findShiftDefByCode, findShiftDefById, findShiftsForDate, findAllShiftDefs, findAssignment, upsertAssignment, bulkUpsertAssignments,
};
