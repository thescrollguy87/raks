const rosterRepo = require("../repositories/rosterRepository");
const leaveRepo = require("../repositories/leaveRepository");
const planningRepo = require("../repositories/rosterPlanningRepository");
const complianceService = require("./complianceService");
const auditTrail = require("../utils/auditTrail");
const ApiError = require("../utils/ApiError");
const { buildRosterAssignments } = require("../utils/rosterGenerationAlgorithm");
const { parseCycle } = require("../utils/shiftPatternCycle");

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

// Continues the rest-gap look-back across the month boundary using each
// staff member's REAL last 3 shift codes from the previous month's roster,
// rather than assuming everyone was OFF on day zero — e.g. someone who
// finished last month on Night gets a rest day next, not thrown straight
// back onto Morning. This reads the previous month's actual (possibly
// hand-edited or coverage-adjusted) assignments, not a theoretical replay,
// so it reflects what really happened. The base rotation phase itself
// (idx*2 in the pure algorithm) does NOT shift with this — only the
// rest-gap prev/prev2/prev3 look-back for days 1-3 of the new month does.
async function buildContinuationTails(stationId, monthKey, staff) {
  const prevKey = previousMonthKey(monthKey);
  const prevRoster = await rosterRepo.findRosterByStationAndMonth(stationId, prevKey);
  if (!prevRoster) {
    throw ApiError.badRequest(`No roster exists for ${prevKey} to continue from — generate that month first, or turn off "continue from previous."`);
  }
  const grid = await rosterRepo.getRosterGrid(stationId, prevRoster.id);
  const byUserId = new Map(grid.map(u => [u.id, u.shiftAssignments]));
  return Object.fromEntries(staff.map(s => {
    const assignments = [...(byUserId.get(s.id) || [])].sort((a, b) => b.shiftDate - a.shiftDate);
    const tail = [0, 1, 2].map(i => assignments[i]?.shiftDef?.code || "O");
    return [s.id, tail];
  }));
}

// Builds the { userId: { codes, offset } } shape buildRosterAssignments'
// pattern mode expects, from each staff member's Staff Allocation row (a
// staff member with no row, or patternId left null/MANUAL, is simply absent
// here and falls back to the default rotation) — mirrors reference-ui's
// `usePatterns` branch reading PATTERNS/ALLOCATIONS.
async function buildPatternByUser(stationId, staff) {
  const [allocations, patterns] = await Promise.all([
    planningRepo.findAllocationsForStation(stationId),
    planningRepo.findPatternsForStation(stationId),
  ]);
  const patternById = new Map(patterns.map(p => [p.id, p]));
  const allocByUserId = new Map(allocations.map(a => [a.userId, a]));
  const staffIds = new Set(staff.map(s => s.id));
  const knownCodes = (await rosterRepo.findAllShiftDefs()).map(d => d.code);

  const result = {};
  for (const userId of staffIds) {
    const alloc = allocByUserId.get(userId);
    if (!alloc || !alloc.patternId) continue;
    const pattern = patternById.get(alloc.patternId);
    if (!pattern) continue;
    result[userId] = { codes: parseCycle(pattern.cycle, knownCodes), offset: alloc.cycleStartDay || 0 };
  }
  return result;
}

// `preview: true` computes the exact same plan (staffing, blocking, leave,
// violations) without writing anything — the "review before you commit"
// step. Calling generateRoster again with preview left off (or false)
// re-runs the identical pure computation and this time persists it; the
// algorithm is deterministic for the same inputs, so there's no separate
// "apply this exact previewed plan" path to keep in sync — a second call is
// the apply.
async function generateRoster(stationId, monthKey, actor, req, options = {}) {
  const { preview = false, continueFromPrevious = false, usePatterns = false, applyLeave = true } = options;
  const staff = await rosterRepo.getActiveStaffForGeneration(stationId);
  if (staff.length === 0) throw ApiError.badRequest("No active staff at this station to generate a roster for");

  // Looked up once and reused by both branches below — the preview needs it
  // to tell the caller whether Apply is about to replace something (matching
  // reference-ui's applyAutoRoster(), which only prompts "this will REPLACE
  // it" when a roster for the month already exists, not on every apply), and
  // the apply branch needs the same row to write into.
  let existingRoster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);

  const nDays = daysInMonth(monthKey);
  const monthStart = dateAt(monthKey, 1);
  const monthEnd = dateAt(monthKey, nDays);

  const [leaves, complianceSummaries, shiftDefs, tailByUser, patternByUser] = await Promise.all([
    leaveRepo.approvedLeaveForStaffInRange(staff.map(s => s.id), monthStart, monthEnd),
    Promise.all(staff.map(s => complianceService.getComplianceSummary(s.id))),
    rosterRepo.findAllShiftDefs(),
    continueFromPrevious ? buildContinuationTails(stationId, monthKey, staff) : Promise.resolve(undefined),
    usePatterns ? buildPatternByUser(stationId, staff) : Promise.resolve(undefined),
  ]);

  const blockedUserIds = staff.filter((s, i) => complianceSummaries[i].isBlocked).map(s => s.id);
  const leaveByUserDay = applyLeave ? buildLeaveByUserDay(leaves, monthKey, nDays) : {};
  const shiftDefsByCode = Object.fromEntries(shiftDefs.map(d => [d.code, d.type]));

  const { assignments, violations } = buildRosterAssignments({ staff, nDays, leaveByUserDay, blockedUserIds, tailByUser, patternByUser, shiftDefsByCode });

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
      existingRosterExists: !!existingRoster,
    };
  }

  // Reuses the exact same roster-lookup path manual edits go through
  // (rosterService.upsertShift), so a generated roster and a hand-edited
  // one are indistinguishable in structure — same rosterId, same
  // shiftAssignment rows, same audit trail conventions.
  let roster = existingRoster;
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
