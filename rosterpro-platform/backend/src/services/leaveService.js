const leaveRepo = require("../repositories/leaveRepository");
const userRepo = require("../repositories/userRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const notificationService = require("./notificationService");
const { assertOwnStation } = require("../utils/stationScope");

function toDateOnly(iso) { return new Date(iso + "T00:00:00.000Z"); }

// Inclusive day count between two dates — the basic unit leave balances are
// tracked in. Doesn't exclude weekends/holidays: for a 24/7 line-maintenance
// roster, "days off work" is the meaningful unit, not "working days."
function daysBetweenInclusive(from, to) {
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000)) + 1;
}

async function requestLeave(body, actor, req) {
  const targetUserId = body.userId || actor.sub;
  let targetStationId = actor.stationId;
  if (targetUserId !== actor.sub) {
    const target = await userRepo.findStationId(targetUserId);
    if (!target) throw ApiError.notFound("Staff member not found");
    await assertOwnStation(actor, target.stationId);
    targetStationId = target.stationId;
  }
  const fromDate = toDateOnly(body.fromDate);
  const toDate = toDateOnly(body.toDate);

  const overlap = await leaveRepo.findOverlapping(targetUserId, fromDate, toDate);
  if (overlap) throw ApiError.conflict("This overlaps an existing pending/approved leave for this person");

  const leave = await leaveRepo.create({
    userId: targetUserId, leaveType: body.leaveType, fromDate, toDate,
    reason: body.reason, actorId: actor.sub,
  });
  await auditTrail.recordCreate("Leave", leave.id, targetStationId, actor, req);
  await auditTrail.logActivity("Leave requested", `${body.leaveType} ${body.fromDate}→${body.toDate}`, targetStationId, actor, req);
  return leave;
}

async function decideLeave(leaveId, { decision, reason }, actor, req) {
  const leave = await leaveRepo.findById(leaveId);
  if (!leave) throw ApiError.notFound("Leave request not found");
  await assertOwnStation(actor, leave.user.stationId);

  // Station-wide approvers (leave:approve) can decide anyone at their
  // station. A Shift Incharge only has leave:approve_reports — narrower,
  // scoped to people who actually report to them (their "L1 Manager"
  // relationship), not the whole station.
  if (!actor.permissions?.includes("leave:approve")) {
    const target = await userRepo.findStationAndManager(leave.userId);
    if (target?.reportsToId !== actor.sub) {
      throw ApiError.forbidden("You can only approve leave for your own direct reports");
    }
  }

  if (leave.status !== "PENDING") throw ApiError.conflict(`Leave is already ${leave.status.toLowerCase()}`);

  const updated = await leaveRepo.decide(leaveId, decision, actor.sub, actor.sub);
  await auditTrail.recordUpdate(
    "Leave", leaveId, leave.user.stationId, { status: leave.status }, { status: decision }, actor, req, reason
  );
  await auditTrail.logActivity(
    decision === "APPROVED" ? "Leave approved" : "Leave rejected",
    `${leave.user.fullName}: ${leave.leaveType}`, leave.user.stationId, actor, req
  );

  notifyLeaveDecisionAsync(leave, decision, reason, actor, req);

  return updated;
}

// Wrapped separately (rather than inline in decideLeave) so a malformed
// leave record can never throw synchronously into decideLeave's caller —
// any failure here, sync or async, is caught and logged, never propagated.
async function notifyLeaveDecisionAsync(leave, decision, reason, actor, req) {
  try {
    await notificationService.notifyLeaveDecision(leave.user, {
      leaveType: leave.leaveType,
      fromDate: leave.fromDate.toISOString().slice(0, 10),
      toDate: leave.toDate.toISOString().slice(0, 10),
      decision, reason,
    });
  } catch (err) {
    await auditTrail.logActivity("Notification error", `Leave decision alert: ${err.message}`, leave.user.stationId, actor, req);
  }
}

async function cancelLeave(leaveId, actor, req) {
  const leave = await leaveRepo.findById(leaveId);
  if (!leave) throw ApiError.notFound("Leave request not found");
  if (leave.userId !== actor.sub) {
    if (!actor.roles?.some(r => ["SUPER_ADMIN", "AIRLINE_ADMIN", "STATION_MANAGER", "LMM"].includes(r))) {
      throw ApiError.forbidden("You can only cancel your own leave requests");
    }
    await assertOwnStation(actor, leave.user.stationId);
  }
  if (!["PENDING", "APPROVED"].includes(leave.status)) throw ApiError.conflict(`Cannot cancel a ${leave.status.toLowerCase()} leave`);

  const updated = await leaveRepo.cancel(leaveId, actor.sub);
  await auditTrail.recordUpdate("Leave", leaveId, leave.user.stationId, { status: leave.status }, { status: "CANCELLED" }, actor, req);
  return updated;
}

function listLeaves(query) {
  const params = { ...query };
  if (params.from) params.from = toDateOnly(params.from);
  if (params.to) params.to = toDateOnly(params.to);
  return leaveRepo.list(params);
}

async function getBalance(userId, year) {
  const user = await userRepo.findById(userId);
  if (!user) throw ApiError.notFound("User not found");

  const approved = await leaveRepo.approvedLeavesForYear(userId, year);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));

  const takenByType = {};
  for (const l of approved) {
    // Clip to the requested year, in case a leave spans a year boundary.
    const from = l.fromDate < yearStart ? yearStart : l.fromDate;
    const to = l.toDate > yearEnd ? yearEnd : l.toDate;
    const days = daysBetweenInclusive(from, to);
    takenByType[l.leaveType] = (takenByType[l.leaveType] || 0) + days;
  }

  const entitlement = leaveRepo.DEFAULT_ENTITLEMENT;
  const balance = {};
  for (const type of Object.keys(entitlement)) {
    const taken = takenByType[type] || 0;
    balance[type] = { entitlement: entitlement[type], taken, remaining: Math.max(0, entitlement[type] - taken) };
  }
  return { userId, year, balance };
}

module.exports = { requestLeave, decideLeave, cancelLeave, listLeaves, getBalance };
