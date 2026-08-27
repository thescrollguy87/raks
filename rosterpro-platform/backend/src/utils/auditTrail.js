const prisma = require("../config/prisma");

// Every service that mutates an audited entity should call one of these
// instead of writing to prisma.auditTrail directly — keeps the shape
// consistent and means "what counts as an audited change" is decided in one
// place, not re-implemented per service.
//
// stationId is always the AFFECTED entity's station, not the actor's — an
// airline-wide admin editing one station's roster still needs that entry to
// show up when someone filters by that station. Callers pass null when the
// entity genuinely has no single station (an Airline record, a login).

async function recordCreate(entityType, entityId, stationId, actor, req) {
  await prisma.auditTrail.create({
    data: {
      entityType, entityId, action: "CREATE", stationId: stationId || null,
      changedById: actor?.sub || null,
      changedByName: actor?.name || "System",
      ipAddress: req?.ip || null,
    },
  });
}

async function recordDelete(entityType, entityId, stationId, actor, req, reason) {
  await prisma.auditTrail.create({
    data: {
      entityType, entityId, action: "DELETE", stationId: stationId || null,
      changedById: actor?.sub || null,
      changedByName: actor?.name || "System",
      ipAddress: req?.ip || null,
      reason: reason || null,
    },
  });
}

// Diffs `before` and `after` field-by-field and writes one AuditTrail row
// per changed field. Pass plain objects (not Prisma model instances) with
// the same keys — anything not present in both is ignored, so callers don't
// need to strip relation objects first.
async function recordUpdate(entityType, entityId, stationId, before, after, actor, req, reason) {
  const rows = [];
  for (const key of Object.keys(after)) {
    if (!(key in before)) continue;
    const oldVal = before[key];
    const newVal = after[key];
    const oldStr = oldVal instanceof Date ? oldVal.toISOString() : String(oldVal ?? "");
    const newStr = newVal instanceof Date ? newVal.toISOString() : String(newVal ?? "");
    if (oldStr === newStr) continue;
    rows.push({
      entityType, entityId, fieldName: key, stationId: stationId || null,
      oldValue: oldStr, newValue: newStr, action: "UPDATE",
      changedById: actor?.sub || null,
      changedByName: actor?.name || "System",
      ipAddress: req?.ip || null,
      reason: reason || null,
    });
  }
  if (rows.length) await prisma.auditTrail.createMany({ data: rows });
  return rows.length;
}

async function history(entityType, entityId) {
  return prisma.auditTrail.findMany({
    where: { entityType, entityId },
    orderBy: { timestamp: "desc" },
  });
}

// Lighter-weight feed for dashboards ("Roster published", "Staff added", ...)
// — separate from the field-level AuditTrail above.
async function logActivity(action, detail, stationId, actor, req) {
  await prisma.activityLog.create({
    data: {
      action, detail: detail || null, stationId: stationId || null,
      userId: actor?.sub || null,
      ipAddress: req?.ip || null,
    },
  });
}

module.exports = { recordCreate, recordUpdate, recordDelete, history, logActivity };
