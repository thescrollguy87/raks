const prisma = require("../config/prisma");

// Field-level change history for one specific record — "everything that
// ever happened to shift assignment X", the core promise of the AuditTrail
// design from Module 1.
function entityHistory(entityType, entityId) {
  return prisma.auditTrail.findMany({
    where: { entityType, entityId },
    orderBy: { timestamp: "desc" },
  });
}

// Paginated, filterable feed across ALL entities — "show me everything
// changed this week" rather than needing to already know which record to
// look at.
async function listAuditTrail({ entityType, changedById, from, to, page = 1, pageSize = 50 }) {
  const where = {
    ...(entityType ? { entityType } : {}),
    ...(changedById ? { changedById } : {}),
    ...(from || to ? { timestamp: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.auditTrail.count({ where }),
    prisma.auditTrail.findMany({
      where, orderBy: { timestamp: "desc" },
      skip: (page - 1) * pageSize, take: pageSize,
    }),
  ]);
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

// The lighter-weight "who did what" feed — one line per action, not
// field-level detail. This is what a dashboard activity widget or a
// station manager's daily "what happened" check actually wants.
async function listActivity({ userId, from, to, page = 1, pageSize = 50 }) {
  const where = {
    ...(userId ? { userId } : {}),
    ...(from || to ? { timestamp: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      where, orderBy: { timestamp: "desc" },
      skip: (page - 1) * pageSize, take: pageSize,
      include: { user: { select: { fullName: true } } },
    }),
  ]);
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

module.exports = { entityHistory, listAuditTrail, listActivity };
