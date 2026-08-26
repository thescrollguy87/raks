const repo = require("../repositories/qualityRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");

function toDate(iso) { return iso ? new Date(iso + "T00:00:00.000Z") : null; }

async function raiseFinding(body, actor, req) {
  const record = await repo.finding.create({
    stationId: body.stationId, raisedById: actor.sub, auditRef: body.auditRef || null,
    category: body.category, severity: body.severity, description: body.description,
    dueDate: toDate(body.dueDate),
    createdById: actor.sub, updatedById: actor.sub,
  });
  await auditTrail.recordCreate("AuditFinding", record.id, actor, req);
  await auditTrail.logActivity("Audit finding raised", `${body.category} (${body.severity})`, actor, req);
  return record;
}

async function updateFinding(id, body, actor, req) {
  const existing = await repo.finding.findById(id);
  if (!existing) throw ApiError.notFound("Finding not found");

  const data = {
    status: body.status ?? existing.status,
    dueDate: body.dueDate ? toDate(body.dueDate) : existing.dueDate,
    description: body.description ?? existing.description,
    updatedById: actor.sub, version: { increment: 1 },
  };
  const updated = await repo.finding.update(id, data);
  await auditTrail.recordUpdate(
    "AuditFinding", id, { status: existing.status }, { status: updated.status }, actor, req
  );
  return updated;
}

async function openCapa(body, actor, req) {
  const finding = await repo.finding.findById(body.findingId);
  if (!finding) throw ApiError.notFound("Audit finding not found");
  if (finding.status === "CLOSED") throw ApiError.conflict("Cannot open a CAPA against a closed finding");

  const record = await repo.capa.create({
    findingId: body.findingId, ownerId: body.ownerId,
    correctiveAction: body.correctiveAction, rootCause: body.rootCause || null,
    preventiveAction: body.preventiveAction || null, targetDate: toDate(body.targetDate),
    createdById: actor.sub, updatedById: actor.sub,
  });
  // Opening a CAPA moves the finding forward if it's still sitting OPEN.
  if (finding.status === "OPEN") {
    await repo.finding.update(finding.id, { status: "IN_PROGRESS", updatedById: actor.sub, version: { increment: 1 } });
  }
  await auditTrail.recordCreate("Capa", record.id, actor, req);
  return record;
}

async function closeCapa(id, body, actor, req) {
  const existing = await repo.capa.findById(id);
  if (!existing) throw ApiError.notFound("CAPA not found");
  if (existing.status === "CLOSED") throw ApiError.conflict("CAPA is already closed");

  const updated = await repo.capa.update(id, {
    status: "CLOSED", closedDate: toDate(body.closedDate),
    updatedById: actor.sub, version: { increment: 1 },
  });
  await auditTrail.recordUpdate(
    "Capa", id, { status: existing.status }, { status: "CLOSED" }, actor, req, body.note
  );

  // If every CAPA against the finding is now closed, close the finding too.
  const siblings = await repo.capa.listForFinding(existing.findingId);
  if (siblings.every(c => c.status === "CLOSED")) {
    await repo.finding.update(existing.findingId, { status: "CLOSED", updatedById: actor.sub, version: { increment: 1 } });
    await auditTrail.logActivity("Audit finding closed", existing.findingId, actor, req);
  }
  return updated;
}

function listFindingsForStation(stationId, status) {
  return repo.finding.listForStation(stationId, status);
}

function listCapasForOwner(ownerId, status) {
  return repo.capa.listForOwner(ownerId, status);
}

// Feeds the "audit due" dashboard widget and Module 4's overdue-CAPA reminder.
async function listOverdue() {
  const [findings, capas] = await Promise.all([repo.finding.listOverdue(), repo.capa.listOverdue()]);
  return { overdueFindings: findings, overdueCapas: capas };
}

module.exports = { raiseFinding, updateFinding, openCapa, closeCapa, listFindingsForStation, listCapasForOwner, listOverdue };
