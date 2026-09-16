// Regularization requests route through the exact same L1 Manager
// relationship as Leave — regularization:approve (station-wide) vs
// regularization:approve_reports (scoped to reportsToId) — see
// leaveService.decideLeave, which this mirrors field-for-field.
const regularizationRepo = require("../repositories/regularizationRepository");
const attendanceRepo = require("../repositories/attendanceRepository");
const userRepo = require("../repositories/userRepository");
const attendanceService = require("./attendanceService");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const notificationService = require("./notificationService");
const { assertOwnStation } = require("../utils/stationScope");

function toDateOnly(iso) { return new Date(iso + "T00:00:00.000Z"); }

async function createRequest(body, actor, req) {
  const targetUserId = body.userId || actor.sub;
  const isSelfRequest = targetUserId === actor.sub;
  const target = await userRepo.findStationAndManager(targetUserId);
  if (!target) throw ApiError.notFound("Staff member not found");
  if (!isSelfRequest) {
    await assertOwnStation(actor, target.stationId);
    // A reports-scoped filer (no station-wide regularization:approve) may
    // only file on behalf of their own direct reports — the same narrowing
    // decide() enforces below, applied symmetrically to filing.
    if (!actor.permissions?.includes("regularization:approve") && target.reportsToId !== actor.sub) {
      throw ApiError.forbidden("You can only submit a regularization request for your own direct reports");
    }
  }

  const date = toDateOnly(body.date);
  const scheduled = await attendanceRepo.findScheduledShift(targetUserId, target.stationId, date);
  const shiftDef = scheduled?.shiftDef;
  if (!shiftDef) {
    throw ApiError.badRequest("There's no scheduled duty for this staff member on this date — nothing to regularize.");
  }
  if (attendanceService.isExemptShiftType(shiftDef.type)) {
    throw ApiError.badRequest(`This day is already explained by the roster (${shiftDef.code}) — no regularization is needed.`);
  }

  let record = await attendanceRepo.findByUserAndDate(targetUserId, date);
  if (!record) {
    record = await attendanceRepo.create({
      userId: targetUserId, stationId: target.stationId, date, status: "MISSING",
      scheduledShiftDefId: scheduled?.shiftDefId || null,
      scheduledShiftCode: shiftDef?.code || null,
      scheduledStartTime: shiftDef?.startTime || null,
      scheduledEndTime: shiftDef?.endTime || null,
    });
  }

  const existingPending = await regularizationRepo.findPendingForAttendanceRecord(record.id);
  if (existingPending) throw ApiError.conflict("A regularization request for this day is already pending");

  const request = await regularizationRepo.create({
    attendanceRecordId: record.id, userId: targetUserId, reason: body.reason, detail: body.detail, submittedById: actor.sub,
  });

  await auditTrail.recordCreate("RegularizationRequest", request.id, target.stationId, actor, req);
  await auditTrail.logActivity("Regularization requested", `${body.date}: ${body.reason}`, target.stationId, actor, req);

  if (isSelfRequest && target.reportsToId) {
    notifyRegularizationRequestedAsync(target.reportsToId, target.fullName, body.date, body.reason, actor, req);
  }
  return request;
}

async function notifyRegularizationRequestedAsync(managerId, staffName, date, reason, actor, req) {
  try {
    const manager = await userRepo.findById(managerId);
    if (!manager) return;
    await notificationService.notifyRegularizationRequested(manager, { staffName, date, reason });
  } catch (err) {
    await auditTrail.logActivity("Notification error", `Regularization request alert: ${err.message}`, null, actor, req);
  }
}

async function decide(id, { decision, reason }, actor, req) {
  const request = await regularizationRepo.findById(id);
  if (!request) throw ApiError.notFound("Regularization request not found");
  await assertOwnStation(actor, request.attendanceRecord.stationId);

  if (!actor.permissions?.includes("regularization:approve")) {
    if (request.user.reportsToId !== actor.sub) {
      throw ApiError.forbidden("You can only decide regularization requests for your own direct reports");
    }
  }
  if (request.status !== "PENDING") throw ApiError.conflict(`Request is already ${request.status.toLowerCase()}`);

  const updated = await regularizationRepo.decide(id, decision, actor.sub, actor.sub, reason);
  if (decision === "APPROVED") {
    await attendanceRepo.update(request.attendanceRecordId, { status: "REGULARIZED" });
  }

  await auditTrail.recordUpdate(
    "RegularizationRequest", id, request.attendanceRecord.stationId,
    { status: request.status }, { status: decision }, actor, req, reason
  );
  await auditTrail.logActivity(
    decision === "APPROVED" ? "Regularization approved" : "Regularization rejected",
    `${request.user.fullName}: ${request.attendanceRecord.date.toISOString().slice(0, 10)}`,
    request.attendanceRecord.stationId, actor, req
  );

  notifyRegularizationDecisionAsync(request, decision, reason, actor, req);
  return updated;
}

async function notifyRegularizationDecisionAsync(request, decision, reason, actor, req) {
  try {
    await notificationService.notifyRegularizationDecision(request.user, {
      date: request.attendanceRecord.date.toISOString().slice(0, 10),
      decision, reason,
    });
  } catch (err) {
    await auditTrail.logActivity("Notification error", `Regularization decision alert: ${err.message}`, request.attendanceRecord.stationId, actor, req);
  }
}

async function cancel(id, actor, req) {
  const request = await regularizationRepo.findById(id);
  if (!request) throw ApiError.notFound("Regularization request not found");
  if (request.userId !== actor.sub) {
    if (!actor.roles?.some(r => ["SUPER_ADMIN", "AIRLINE_ADMIN", "STATION_MANAGER", "LMM", "SHIFT_INCHARGE"].includes(r))) {
      throw ApiError.forbidden("You can only cancel your own regularization requests");
    }
    await assertOwnStation(actor, request.attendanceRecord.stationId);
  }
  if (request.status !== "PENDING") throw ApiError.conflict(`Cannot cancel a ${request.status.toLowerCase()} request`);

  const updated = await regularizationRepo.cancel(id, actor.sub);
  await auditTrail.recordUpdate(
    "RegularizationRequest", id, request.attendanceRecord.stationId,
    { status: "PENDING" }, { status: "CANCELLED" }, actor, req
  );
  return updated;
}

function list(query) {
  const params = { ...query };
  if (params.from) params.from = toDateOnly(params.from);
  if (params.to) params.to = toDateOnly(params.to);
  return regularizationRepo.list(params);
}

module.exports = { createRequest, decide, cancel, list };
