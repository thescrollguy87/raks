const prisma = require("../config/prisma");

function create({ attendanceRecordId, userId, reason, detail, submittedById }) {
  return prisma.regularizationRequest.create({
    data: {
      attendanceRecordId, userId, reason, detail: detail || null,
      submittedById, createdById: submittedById, updatedById: submittedById,
    },
  });
}

function findById(id) {
  return prisma.regularizationRequest.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, email: true, stationId: true, reportsToId: true } },
      attendanceRecord: true,
      approver: { select: { id: true, fullName: true, roles: { select: { role: { select: { name: true } } } } } },
    },
  });
}

function findPendingForAttendanceRecord(attendanceRecordId) {
  return prisma.regularizationRequest.findFirst({ where: { attendanceRecordId, status: "PENDING" } });
}

function decide(id, status, approvedById, actorId, comment) {
  return prisma.regularizationRequest.update({
    where: { id },
    data: { status, approvedById, approvedAt: new Date(), comment: comment || null, updatedById: actorId, version: { increment: 1 } },
  });
}

function cancel(id, actorId) {
  return prisma.regularizationRequest.update({
    where: { id },
    data: { status: "CANCELLED", updatedById: actorId, version: { increment: 1 } },
  });
}

function list({ userId, userIdIn, stationId, stationIdIn, reportsToId, status, from, to, page = 1, pageSize = 50 }) {
  const where = {
    ...(userId ? { userId } : {}),
    ...(userIdIn ? { userId: { in: userIdIn } } : {}),
    ...(status ? { status: Array.isArray(status) ? { in: status } : status } : {}),
    ...(reportsToId ? { user: { reportsToId } } : {}),
    attendanceRecord: {
      ...(stationId ? { stationId } : {}),
      ...(stationIdIn ? { stationId: { in: stationIdIn } } : {}),
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
  };
  return Promise.all([
    prisma.regularizationRequest.count({ where }),
    prisma.regularizationRequest.findMany({
      where, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, fullName: true, category: true } },
        approver: { select: { id: true, fullName: true } },
        attendanceRecord: { select: { date: true, scheduledShiftCode: true, status: true, punchInAt: true, punchOutAt: true } },
      },
    }),
  ]).then(([total, items]) => ({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }));
}

module.exports = { create, findById, findPendingForAttendanceRecord, decide, cancel, list };
