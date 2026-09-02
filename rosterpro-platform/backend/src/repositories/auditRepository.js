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
// look at. stationId filters to the entity's own station (a real column on
// the row, not derived from who made the change).
// stationIdIn is the multi-station form of the same scope stationId
// expresses for one station — an airline-wide caller who didn't name a
// single station gets every station belonging to their OWN airline (a
// real DB-level IN filter resolved by the caller), never every station on
// the platform. Passing neither (SUPER_ADMIN, or nothing at all) means no
// station filter — the one case that's actually meant to see everything.
async function listAuditTrail({ entityType, changedById, stationId, stationIdIn, from, to, page = 1, pageSize = 50 }) {
  const where = {
    ...(entityType ? { entityType } : {}),
    ...(changedById ? { changedById } : {}),
    ...(stationId ? { stationId } : {}),
    ...(stationIdIn ? { stationId: { in: stationIdIn } } : {}),
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
// station manager's daily "what happened" check actually wants. stationId
// filters to the affected entity's own station (a real column on the row),
// not the acting user's station.
async function listActivity({ userId, stationId, stationIdIn, from, to, page = 1, pageSize = 50 }) {
  const where = {
    ...(userId ? { userId } : {}),
    ...(stationId ? { stationId } : {}),
    ...(stationIdIn ? { stationId: { in: stationIdIn } } : {}),
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
