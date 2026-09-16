const prisma = require("../config/prisma");

function findByUserAndDate(userId, date) {
  return prisma.attendanceRecord.findUnique({ where: { userId_date: { userId, date } } });
}

function findById(id) {
  return prisma.attendanceRecord.findUnique({
    where: { id },
    include: { user: { select: { id: true, fullName: true, category: true, stationId: true, reportsToId: true } } },
  });
}

// The roster's own answer for "what was this person scheduled to do on this
// exact date" — queried directly against ShiftAssignment rather than
// reusing rosterRepo.getRosterGrid, which fetches every staff member's
// whole month; a punch only ever needs one person's one day.
function findScheduledShift(userId, stationId, date) {
  return prisma.shiftAssignment.findFirst({
    where: { userId, shiftDate: date, deletedAt: null, roster: { stationId, deletedAt: null } },
    select: {
      shiftDefId: true,
      shiftDef: { select: { code: true, name: true, type: true, startTime: true, endTime: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// Every ShiftAssignment for one user across a date range, in one query —
// the batched form of findScheduledShift, used wherever a whole month
// (not just one day) needs "what was scheduled" (the daily overview /
// monthly register), to avoid a query per day.
function findScheduledShiftsForRange(userId, stationId, from, to) {
  return prisma.shiftAssignment.findMany({
    where: { userId, shiftDate: { gte: from, lte: to }, deletedAt: null, roster: { stationId, deletedAt: null } },
    select: {
      shiftDate: true, shiftDefId: true,
      shiftDef: { select: { code: true, name: true, type: true, startTime: true, endTime: true } },
    },
    orderBy: { shiftDate: "asc" },
  });
}

function create(data) {
  return prisma.attendanceRecord.create({ data });
}

function update(id, data) {
  return prisma.attendanceRecord.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
}

// stationIdIn mirrors every other station-scoped list() in this app (see
// leaveRepository.list) — a specific station once verified, or every
// station the caller's own airline actually has, never "no filter".
function list({ userId, userIdIn, stationId, stationIdIn, status, from, to, page = 1, pageSize = 100 }) {
  const where = {
    ...(userId ? { userId } : {}),
    ...(userIdIn ? { userId: { in: userIdIn } } : {}),
    ...(status ? { status: Array.isArray(status) ? { in: status } : status } : {}),
    ...(stationId ? { stationId } : {}),
    ...(stationIdIn ? { stationId: { in: stationIdIn } } : {}),
    ...(from ? { date: { gte: from } } : {}),
    ...(to ? { date: { lte: to } } : {}),
  };
  return Promise.all([
    prisma.attendanceRecord.count({ where }),
    prisma.attendanceRecord.findMany({
      where, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: { date: "desc" },
      include: {
        user: { select: { id: true, fullName: true, category: true } },
        regularizationRequests: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
  ]).then(([total, items]) => ({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }));
}

// Every attendance row for one station across a date range, keyed by
// userId+date — the shape the monthly register report builds from.
function listForRange(stationId, from, to) {
  return prisma.attendanceRecord.findMany({
    where: { stationId, date: { gte: from, lte: to } },
    include: {
      user: { select: { id: true, fullName: true, category: true, employeeId: true } },
      regularizationRequests: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: [{ date: "asc" }],
  });
}

// Every attendance row for one exact date across the whole platform — used
// only by the shift-end-reminder cron job to know who's already punched
// out, so it isn't scoped to one station (the job itself iterates every
// station's ending shifts in one pass, same as the existing daily reminder).
function listForDate(date) {
  return prisma.attendanceRecord.findMany({ where: { date }, select: { userId: true, punchOutAt: true } });
}

module.exports = { findByUserAndDate, findById, findScheduledShift, findScheduledShiftsForRange, create, update, list, listForRange, listForDate };
