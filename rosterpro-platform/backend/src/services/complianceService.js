const repo = require("../repositories/complianceRepository");
const userRepo = require("../repositories/userRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const { assertOwnStation } = require("../utils/stationScope");

// Compliance records don't carry their own stationId — they belong to a
// user, who belongs to a station. Every write below resolves the target
// user's station and checks it against the actor, same rule as everywhere
// else: a Station Manager can only touch their own station's people.
async function assertActorSharesStationWith(actor, userId) {
  const target = await userRepo.findStationId(userId);
  if (!target) throw ApiError.notFound("Staff member not found");
  assertOwnStation(actor, target.stationId);
}

const EXPIRING_WINDOW_DAYS = 30;

// The single place "is this expiring soon" gets decided — used for
// Qualification's persisted status column, and computed on-the-fly for
// License/Training/Authorization which don't store a status column (no
// need to persist something this cheap to derive from a date on every read).
function deriveStatus(expiryDate) {
  if (!expiryDate) return "VALID"; // no expiry = doesn't expire (e.g. an open-ended authorization)
  const now = new Date();
  const cutoff = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (expiryDate < now) return "EXPIRED";
  if (expiryDate <= cutoff) return "EXPIRING";
  return "VALID";
}

function toDate(iso) { return iso ? new Date(iso + "T00:00:00.000Z") : null; }

// ── Qualifications ───────────────────────────────────────────────────────────

async function createQualification(body, actor, req) {
  await assertActorSharesStationWith(actor, body.userId);
  const data = {
    userId: body.userId, qualCode: body.qualCode, description: body.description || null,
    issuedDate: toDate(body.issuedDate), expiryDate: toDate(body.expiryDate),
    attachmentId: body.attachmentId || null,
    status: deriveStatus(toDate(body.expiryDate)),
    createdById: actor.sub, updatedById: actor.sub,
  };
  const record = await repo.qualification.create(data);
  await auditTrail.recordCreate("Qualification", record.id, actor, req);
  return record;
}

async function updateQualification(id, body, actor, req) {
  const existing = await repo.qualification.findById(id);
  if (!existing) throw ApiError.notFound("Qualification not found");
  await assertActorSharesStationWith(actor, existing.userId);

  const newExpiry = body.expiryDate ? toDate(body.expiryDate) : existing.expiryDate;
  const data = {
    qualCode: body.qualCode ?? existing.qualCode,
    description: body.description ?? existing.description,
    issuedDate: body.issuedDate ? toDate(body.issuedDate) : existing.issuedDate,
    expiryDate: newExpiry,
    status: deriveStatus(newExpiry),
    updatedById: actor.sub, version: { increment: 1 },
  };
  const updated = await repo.qualification.update(id, data);
  await auditTrail.recordUpdate(
    "Qualification", id,
    { qualCode: existing.qualCode, expiryDate: existing.expiryDate?.toISOString() },
    { qualCode: updated.qualCode, expiryDate: updated.expiryDate?.toISOString() },
    actor, req
  );
  return updated;
}

async function deleteQualification(id, actor, req, reason) {
  const existing = await repo.qualification.findById(id);
  if (!existing) throw ApiError.notFound("Qualification not found");
  await assertActorSharesStationWith(actor, existing.userId);
  await repo.qualification.softDelete(id, actor.sub);
  await auditTrail.recordDelete("Qualification", id, actor, req, reason);
}

function listQualificationsForUser(userId) {
  // Re-derive status on read rather than trusting the stored column — a
  // qualification stored as VALID a month ago should show EXPIRING today
  // even if nothing has explicitly re-saved it since.
  return repo.qualification.listForUser(userId)
    .then(rows => rows.map(r => ({ ...r, status: deriveStatus(r.expiryDate) })));
}

// Feeds Module 4's daily expiry-reminder job and the dashboard's
// "qualification expiry" widget.
function listExpiringQualifications(days = EXPIRING_WINDOW_DAYS) {
  return repo.qualification.listExpiringWithin(days);
}

// ── Licenses ──────────────────────────────────────────────────────────────

async function createLicense(body, actor, req) {
  await assertActorSharesStationWith(actor, body.userId);
  const data = {
    userId: body.userId, licenseNo: body.licenseNo, category: body.category,
    issuingAuthority: body.issuingAuthority || "DGCA",
    issuedDate: toDate(body.issuedDate), expiryDate: toDate(body.expiryDate),
    attachmentId: body.attachmentId || null,
    createdById: actor.sub, updatedById: actor.sub,
  };
  const record = await repo.license.create(data);
  await auditTrail.recordCreate("License", record.id, actor, req);
  return record;
}

async function updateLicense(id, body, actor, req) {
  const existing = await repo.license.findById(id);
  if (!existing) throw ApiError.notFound("License not found");
  await assertActorSharesStationWith(actor, existing.userId);
  const data = {
    licenseNo: body.licenseNo ?? existing.licenseNo,
    category: body.category ?? existing.category,
    issuingAuthority: body.issuingAuthority ?? existing.issuingAuthority,
    issuedDate: body.issuedDate ? toDate(body.issuedDate) : existing.issuedDate,
    expiryDate: body.expiryDate ? toDate(body.expiryDate) : existing.expiryDate,
    updatedById: actor.sub, version: { increment: 1 },
  };
  const updated = await repo.license.update(id, data);
  await auditTrail.recordUpdate(
    "License", id,
    { licenseNo: existing.licenseNo, expiryDate: existing.expiryDate?.toISOString() },
    { licenseNo: updated.licenseNo, expiryDate: updated.expiryDate?.toISOString() },
    actor, req
  );
  return updated;
}

function listLicensesForUser(userId) {
  return repo.license.listForUser(userId)
    .then(rows => rows.map(r => ({ ...r, status: deriveStatus(r.expiryDate) })));
}

function listExpiringLicenses(days = EXPIRING_WINDOW_DAYS) {
  return repo.license.listExpiringWithin(days);
}

// ── Training ──────────────────────────────────────────────────────────────

async function createTraining(body, actor, req) {
  await assertActorSharesStationWith(actor, body.userId);
  const data = {
    userId: body.userId, courseName: body.courseName, provider: body.provider || null,
    completedDate: toDate(body.completedDate), validUntil: toDate(body.validUntil),
    attachmentId: body.attachmentId || null,
    createdById: actor.sub, updatedById: actor.sub,
  };
  const record = await repo.training.create(data);
  await auditTrail.recordCreate("Training", record.id, actor, req);
  return record;
}

function listTrainingForUser(userId) {
  return repo.training.listForUser(userId)
    .then(rows => rows.map(r => ({ ...r, status: r.validUntil ? deriveStatus(r.validUntil) : "VALID" })));
}

// ── Authorizations ───────────────────────────────────────────────────────────

async function createAuthorization(body, actor, req) {
  await assertActorSharesStationWith(actor, body.userId);
  const data = {
    userId: body.userId, scope: body.scope,
    grantedDate: toDate(body.grantedDate), expiryDate: toDate(body.expiryDate),
    createdById: actor.sub, updatedById: actor.sub,
  };
  const record = await repo.authorization.create(data);
  await auditTrail.recordCreate("StaffAuthorization", record.id, actor, req);
  return record;
}

function listAuthorizationsForUser(userId) {
  return repo.authorization.listForUser(userId)
    .then(rows => rows.map(r => ({ ...r, status: deriveStatus(r.expiryDate) })));
}

// ── Combined view ─────────────────────────────────────────────────────────

// The dashboard/roster-generation "is this person blocked from duty" check
// needs the full compliance picture in one call — mirrors the prototype's
// isStaffBlocked, now backed by real, per-record expiry dates instead of a
// single flat qualifications list.
async function getComplianceSummary(userId) {
  const [quals, licenses, trainings, authorizations] = await Promise.all([
    listQualificationsForUser(userId), listLicensesForUser(userId),
    listTrainingForUser(userId), listAuthorizationsForUser(userId),
  ]);
  const hasExpired = [...quals, ...licenses].some(r => r.status === "EXPIRED");
  return { qualifications: quals, licenses, trainings, authorizations, isBlocked: hasExpired };
}

module.exports = {
  deriveStatus, assertActorSharesStationWith,
  createQualification, updateQualification, deleteQualification, listQualificationsForUser, listExpiringQualifications,
  createLicense, updateLicense, listLicensesForUser, listExpiringLicenses,
  createTraining, listTrainingForUser,
  createAuthorization, listAuthorizationsForUser,
  getComplianceSummary,
};
