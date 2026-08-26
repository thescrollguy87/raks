const rosterRepo = require("../repositories/rosterRepository");
const leaveRepo = require("../repositories/leaveRepository");
const complianceService = require("./complianceService");
const auditTrail = require("../utils/auditTrail");
const ApiError = require("../utils/ApiError");
const { buildRosterAssignments } = require("../utils/rosterGenerationAlgorithm");

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function dateAt(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

// Builds the { userId: Set(days) } shape the pure algorithm expects, from
// the flat list of approved leave records the repo returns — this is
// deliberately the ONLY place date-range-to-day-set conversion happens, so
// the algorithm itself never has to know about actual calendar dates.
function buildLeaveByUserDay(leaves, monthKey, nDays) {
  const map = {};
  const monthStart = dateAt(monthKey, 1);
  const monthEnd = dateAt(monthKey, nDays);
  for (const l of leaves) {
    const from = l.fromDate < monthStart ? monthStart : l.fromDate;
    const to = l.toDate > monthEnd ? monthEnd : l.toDate;
    const days = map[l.userId] ??= new Set();
    for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      days.add(d.getUTCDate());
    }
  }
  return map;
}

async function generateRoster(stationId, monthKey, actor, req) {
  const staff = await rosterRepo.getActiveStaffForGeneration(stationId);
  if (staff.length === 0) throw ApiError.badRequest("No active staff at this station to generate a roster for");

  const nDays = daysInMonth(monthKey);
  const monthStart = dateAt(monthKey, 1);
  const monthEnd = dateAt(monthKey, nDays);

  const [leaves, complianceSummaries, shiftDefs] = await Promise.all([
    leaveRepo.approvedLeaveForStaffInRange(staff.map(s => s.id), monthStart, monthEnd),
    Promise.all(staff.map(s => complianceService.getComplianceSummary(s.id))),
    rosterRepo.findAllShiftDefs(),
  ]);

  const blockedUserIds = staff.filter((s, i) => complianceSummaries[i].isBlocked).map(s => s.id);
  const leaveByUserDay = buildLeaveByUserDay(leaves, monthKey, nDays);

  const { assignments, violations } = buildRosterAssignments({ staff, nDays, leaveByUserDay, blockedUserIds });

  // Resolve shift codes (M/A/N/O/L) to real ShiftDefinition ids — if any of
  // these seed codes are missing at this station's shift-definition set,
  // fail loudly rather than silently generating a broken roster.
  const codeToId = Object.fromEntries(shiftDefs.map(d => [d.code, d.id]));
  const missingCodes = [...new Set(assignments.map(a => a.code))].filter(c => !codeToId[c]);
  if (missingCodes.length) {
    throw ApiError.badRequest(`Cannot generate: shift code(s) not defined: ${missingCodes.join(", ")}. Seed the M/A/N/O/L shift definitions first.`);
  }

  // Reuses the exact same roster-lookup path manual edits go through
  // (rosterService.upsertShift), so a generated roster and a hand-edited
  // one are indistinguishable in structure — same rosterId, same
  // shiftAssignment rows, same audit trail conventions.
  let roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  if (!roster) roster = await rosterRepo.createRoster(stationId, monthKey, actor.sub);
  if (roster.isPublished) throw ApiError.forbidden("Roster is published — unpublish before regenerating");

  const rows = assignments.map(a => ({
    rosterId: roster.id, userId: a.userId, shiftDate: dateAt(monthKey, a.day),
    shiftDefId: codeToId[a.code], note: null, actorId: actor.sub,
  }));
  await rosterRepo.bulkUpsertAssignments(rows);

  await auditTrail.logActivity(
    "Roster generated",
    `${stationId} — ${monthKey}: ${staff.length} staff, ${blockedUserIds.length} blocked, ${violations.length} coverage gaps`,
    actor, req
  );

  return {
    roster, staffCount: staff.length, blockedCount: blockedUserIds.length,
    assignmentCount: assignments.length, violations,
  };
}

module.exports = { generateRoster, buildLeaveByUserDay };
