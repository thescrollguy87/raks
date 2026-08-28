const prisma = require("../config/prisma");

function create({ userId, leaveType, fromDate, toDate, reason, actorId }) {
  return prisma.leave.create({
    data: { userId, leaveType, fromDate, toDate, reason: reason || null, createdById: actorId, updatedById: actorId },
  });
}

function findById(id) {
  return prisma.leave.findUnique({ where: { id }, include: { user: { select: { id: true, fullName: true, email: true, phone: true, stationId: true } } } });
}

function decide(id, status, approvedById, actorId) {
  return prisma.leave.update({
    where: { id },
    data: { status, approvedById, approvedAt: new Date(), updatedById: actorId, version: { increment: 1 } },
  });
}

function cancel(id, actorId) {
  return prisma.leave.update({
    where: { id },
    data: { status: "CANCELLED", updatedById: actorId, version: { increment: 1 } },
  });
}

// Detects overlap with any existing non-rejected/non-cancelled leave for the
// same person — used to block double-booking leave over the same dates.
function findOverlapping(userId, fromDate, toDate, excludeId) {
  return prisma.leave.findFirst({
    where: {
      userId,
      id: excludeId ? { not: excludeId } : undefined,
      status: { in: ["PENDING", "APPROVED"] },
      deletedAt: null,
      fromDate: { lte: toDate },
      toDate: { gte: fromDate },
    },
  });
}

function list({ userId, stationId, reportsToId, status, from, to, page, pageSize }) {
  const where = {
    deletedAt: null,
    ...(userId ? { userId } : {}),
    ...(status ? { status } : {}),
    ...(stationId ? { user: { stationId } } : {}),
    ...(reportsToId ? { user: { reportsToId } } : {}),
    ...(from ? { toDate: { gte: from } } : {}),
    ...(to ? { fromDate: { lte: to } } : {}),
  };
  return Promise.all([
    prisma.leave.count({ where }),
    prisma.leave.findMany({
      where, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: { fromDate: "desc" },
      include: { user: { select: { id: true, fullName: true, category: true } } },
    }),
  ]).then(([total, items]) => ({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }));
}

// Simple leave-balance calculation: entitlement minus approved days taken
// this calendar year, per leave type. Real entitlement policy (carry-over,
// pro-rating for mid-year joiners, category-specific rules) belongs in a
// LeavePolicy table once you need it — this is a reasonable v1.
const DEFAULT_ENTITLEMENT = { ANNUAL: 30, SICK: 12, CASUAL: 12, MEDICAL: 0, LWP: 0, TRAINING: 0, OTHER: 0 };

// Returns raw approved leave rows for the year — day-counting (including
// clipping a leave that spans across Dec 31 → Jan 1) is date math that
// belongs in the service layer, not buried in a query.
function approvedLeavesForYear(userId, year) {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  return prisma.leave.findMany({
    where: {
      userId, status: "APPROVED", deletedAt: null,
      fromDate: { lte: yearEnd }, toDate: { gte: yearStart },
    },
    select: { leaveType: true, fromDate: true, toDate: true },
  });
}

// Returns approved leave overlapping the given range, for any of the given
// staff — used by the roster generator to skip assigning duty on days
// someone is already confirmed off. One query for the whole station/month
// rather than one query per staff member per day.
function approvedLeaveForStaffInRange(userIds, from, to) {
  return prisma.leave.findMany({
    where: {
      userId: { in: userIds }, status: "APPROVED", deletedAt: null,
      fromDate: { lte: to }, toDate: { gte: from },
    },
    select: { userId: true, fromDate: true, toDate: true },
  });
}

module.exports = { create, findById, decide, cancel, findOverlapping, list, approvedLeavesForYear, approvedLeaveForStaffInRange, DEFAULT_ENTITLEMENT };
