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

function previousMonthKey(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Continues each staff member's 8-day rotation from where the theoretical
// (unperturbed) cycle would be after the previous month's day count, rather
// than restarting everyone at phase 0 — e.g. if last month ended mid-cycle,
// this month picks up from there instead of every staff member coincidentally
// starting on a Morning shift again. This is deliberately the *unperturbed*
// continuation (based on the previous month's length, not that month's
// actual leave/coverage-adjusted assignments) — reconstructing each
// person's true phase from a roster that leave and coverage passes already
// nudged around isn't reliably possible without re-deriving intent, so this
// keeps the guarantee simple and honest: the rotation keeps advancing
// station-wide, it doesn't silently reset.
async function buildContinuationOffsets(stationId, monthKey, staff) {
  const prevKey = previousMonthKey(monthKey);
  const prevRoster = await rosterRepo.findRosterByStationAndMonth(stationId, prevKey);
  if (!prevRoster) {
    throw ApiError.badRequest(`No roster exists for ${prevKey} to continue from — generate that month first, or turn off "continue from previous."`);
  }
  const prevNDays = daysInMonth(prevKey);
  return Object.fromEntries(staff.map((s, idx) => [s.id, idx + prevNDays]));
}

// `preview: true` computes the exact same plan (staffing, blocking, leave,
// violations) without writing anything — the "review before you commit"
// step. Calling generateRoster again with preview left off (or false)
// re-runs the identical pure computation and this time persists it; the
// algorithm is deterministic for the same inputs, so there's no separate
// "apply this exact previewed plan" path to keep in sync — a second call is
// the apply.
async function generateRoster(stationId, monthKey, actor, req, options = {}) {
  const { preview = false, continueFromPrevious = false } = options;
  const staff = await rosterRepo.getActiveStaffForGeneration(stationId);
  if (staff.length === 0) throw ApiError.badRequest("No active staff at this station to generate a roster for");

  const nDays = daysInMonth(monthKey);
  const monthStart = dateAt(monthKey, 1);
  const monthEnd = dateAt(monthKey, nDays);

  const [leaves, complianceSummaries, shiftDefs, rotationOffsetByUser] = await Promise.all([
    leaveRepo.approvedLeaveForStaffInRange(staff.map(s => s.id), monthStart, monthEnd),
    Promise.all(staff.map(s => complianceService.getComplianceSummary(s.id))),
    rosterRepo.findAllShiftDefs(),
    continueFromPrevious ? buildContinuationOffsets(stationId, monthKey, staff) : Promise.resolve(undefined),
  ]);

  const blockedUserIds = staff.filter((s, i) => complianceSummaries[i].isBlocked).map(s => s.id);
  const leaveByUserDay = buildLeaveByUserDay(leaves, monthKey, nDays);

  const { assignments, violations } = buildRosterAssignments({ staff, nDays, leaveByUserDay, blockedUserIds, rotationOffsetByUser });

  // Resolve shift codes (M/A/N/O/L) to real ShiftDefinition ids — if any of
  // these seed codes are missing at this station's shift-definition set,
  // fail loudly rather than silently generating a broken roster.
  const codeToId = Object.fromEntries(shiftDefs.map(d => [d.code, d.id]));
  const missingCodes = [...new Set(assignments.map(a => a.code))].filter(c => !codeToId[c]);
  if (missingCodes.length) {
    throw ApiError.badRequest(`Cannot generate: shift code(s) not defined: ${missingCodes.join(", ")}. Seed the M/A/N/O/L shift definitions first.`);
  }

  // Manpower plan: how many of each category are on duty per shift, summed
  // across the month — the "review this before committing" number a
  // manager actually wants, distinct from the per-day violations list.
  const manpowerByShift = { M: {}, A: {}, N: {} };
  for (const a of assignments) {
    if (a.code !== "M" && a.code !== "A" && a.code !== "N") continue;
    const cat = staff.find(s => s.id === a.userId)?.category || "NCS";
    manpowerByShift[a.code][cat] = (manpowerByShift[a.code][cat] || 0) + 1;
  }

  if (preview) {
    return {
      preview: true, staffCount: staff.length, blockedCount: blockedUserIds.length,
      assignmentCount: assignments.length, violations, manpowerByShift,
    };
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
    stationId, actor, req
  );

  return {
    roster, staffCount: staff.length, blockedCount: blockedUserIds.length,
    assignmentCount: assignments.length, violations, manpowerByShift,
  };
}

module.exports = { generateRoster, buildLeaveByUserDay };
