// The Roster Assistant's "tools" — one function per capability Gemini is
// allowed to invoke. CRITICAL RULE (do not violate this while editing):
// every function here ONLY calls real, already-existing, already-tested
// backend functions (repositories/services already used by the app's real
// API endpoints) and returns their real values, reshaped for a chat
// answer. Nothing in this file computes roster demand, checks a rule,
// classifies a shift, or does date arithmetic on its own — that logic
// lives exactly once, in the files these functions call into. If a new
// question needs math this file doesn't already have a real function for,
// the fix is a new real function elsewhere (or a small additive export),
// never inline math here.
//
// SCOPING: every tool signature below takes only the arguments an LLM
// should be trusted to supply (a date, a shift code, a name to resolve).
// stationId/airlineId are NEVER read from those arguments — they come
// from `ctx`, which chatAssistantService.js populates ONCE per request
// from the caller's own session (the station currently selected in the
// frontend's switcher, validated against the caller's real access via
// assertOwnStation before any tool ever runs). A tool cannot be tricked
// into acting on a different station no matter what the model passes,
// because there is nowhere in these signatures for it to pass one.
const rosterRepo = require("../repositories/rosterRepository");
const leaveRepo = require("../repositories/leaveRepository");
const workloadConfigService = require("./workloadConfigService");
const ruleBuilderService = require("./ruleBuilderService");
const flightScheduleService = require("./flightScheduleService");
const departureAllocationService = require("./departureAllocationService");
const {
  buildWorkloadContext, buildStaffWithShifts, buildRuleShiftDefsByCode, daysInMonth, dateAt,
} = require("./rosterGenerationService");
const { shiftFamily } = require("../utils/rosterGenerationAlgorithm");
const { checkHardRuleCompliance } = require("../utils/ruleEngine");
const { assertOwnStation } = require("../utils/stationScope");
const ApiError = require("../utils/ApiError");

const SHIFT_NAME = { M: "Morning", A: "Afternoon", N: "Night" };

function parseDateArg(dateStr) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr || "").trim());
  if (!d) throw ApiError.badRequest(`"${dateStr}" isn't a YYYY-MM-DD date`);
  return { year: +d[1], month: +d[2], day: +d[3], monthKey: `${d[1]}-${d[2]}` };
}

function parseShiftArg(shiftStr) {
  const s = (shiftStr || "").trim().toUpperCase();
  const byWord = { MORNING: "M", AFTERNOON: "A", NIGHT: "N" };
  const code = byWord[s] || s;
  if (!SHIFT_NAME[code]) throw ApiError.badRequest(`"${shiftStr}" isn't a recognized shift (Morning/Afternoon/Night)`);
  return code;
}

// Read-only lookup of a station's published roster for one month — unlike
// rosterService.getRosterGrid, this NEVER creates a Roster row as a side
// effect of asking a question (that service auto-creates one on first
// access, which is correct for the roster-editing UI but would be a real,
// surprising write triggered by a chat question — never acceptable here).
async function findRosterGridReadOnly(stationId, monthKey) {
  const roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  if (!roster) return { roster: null, staff: [] };
  const staff = await rosterRepo.getRosterGrid(stationId, roster.id);
  return { roster, staff };
}

// One staff member's assignment on one exact calendar date, from a
// getRosterGrid() row — shared by several tools below so "which shift is
// this code, and what date does it fall on" is resolved identically
// everywhere.
function assignmentOnDate(staffRow, dateStr) {
  return staffRow.shiftAssignments.find(a => new Date(a.shiftDate).toISOString().slice(0, 10) === dateStr);
}

async function shiftDefsByCodeFlat(airlineId) {
  const defs = await rosterRepo.findAllShiftDefs(airlineId);
  return { defs, flat: Object.fromEntries(defs.map(d => [d.code, d.type])) };
}

// ── 1. getCategoryRequirement ───────────────────────────────────────────────
// The REAL combined requirement for one category on one date+shift — the
// higher of the Mandatory Minimum Coverage floor and the workload-driven
// advisory target, exactly the two numbers buildRosterAssignments' own
// two-tier coverage pass fills toward (see rosterGenerationAlgorithm.js) —
// vs how many of that category are ACTUALLY on the published roster that
// shift. This is deliberately the union of both real targets, since that's
// what generation itself converges to; getMandatoryCoverageStatus below
// reports the mandatory floor ALONE, on purpose — the two must never be
// conflated in an answer.
async function getCategoryRequirement(args, ctx) {
  await assertOwnStation(ctx.actor, ctx.stationId);
  const { day, monthKey } = parseDateArg(args.date);
  const shift = parseShiftArg(args.shift);
  const dateStr = args.date;

  const [workloadContext, { staff }, { flat: shiftDefsByCode }] = await Promise.all([
    buildWorkloadContext(ctx.stationId, monthKey, undefined, 0, ctx.airlineId),
    findRosterGridReadOnly(ctx.stationId, monthKey),
    shiftDefsByCodeFlat(ctx.airlineId),
  ]);

  const advisoryForDay = workloadContext.advisoryDemand?.[day]?.[shift] || {};
  const categories = ["B1", "B2", "CM", "NCS"];
  const rows = categories.map(category => {
    const mandatoryCfg = workloadContext.mandatoryCoverageConfig?.[category]?.[shift];
    const mandatoryMin = mandatoryCfg?.enabled ? Math.max(1, +mandatoryCfg.min || 1) : 0;
    const advisoryTarget = +advisoryForDay[category] || 0;
    const required = Math.max(mandatoryMin, advisoryTarget);
    const available = staff.filter(s => {
      if ((s.category || "NCS") !== category) return false;
      const a = assignmentOnDate(s, dateStr);
      return a && shiftFamily(a.shiftDef.code, shiftDefsByCode) === shift;
    }).length;
    return {
      category, required, available,
      status: available >= required ? "OK" : "SHORT",
      shortfall: Math.max(0, required - available),
    };
  });

  return {
    date: dateStr, shift, shiftName: SHIFT_NAME[shift],
    rosterPublished: !!staff.length && staff.some(s => assignmentOnDate(s, dateStr)),
    demandSource: workloadContext.demandSource,
    categories: rows,
  };
}

// ── 2. getMandatoryCoverageStatus ───────────────────────────────────────────
// The Mandatory Minimum Coverage floor ONLY — deliberately ignores
// workload-driven advisory sizing (a different, separate concept in this
// app; see rosterGenerationAlgorithm.js's two-tier coverage pass comment).
async function getMandatoryCoverageStatus(args, ctx) {
  await assertOwnStation(ctx.actor, ctx.stationId);
  const { monthKey } = parseDateArg(args.date);
  const shift = parseShiftArg(args.shift);
  const dateStr = args.date;

  const [mandatoryCoverageConfig, { staff }, { flat: shiftDefsByCode }] = await Promise.all([
    workloadConfigService.getMandatoryCoverageConfigForGeneration(ctx.stationId),
    findRosterGridReadOnly(ctx.stationId, monthKey),
    shiftDefsByCodeFlat(ctx.airlineId),
  ]);

  const categories = ["B1", "B2", "CM", "NCS"].filter(c => mandatoryCoverageConfig?.[c]?.[shift]?.enabled);
  const rows = categories.map(category => {
    const min = Math.max(1, +mandatoryCoverageConfig[category][shift].min || 1);
    const actual = staff.filter(s => {
      if ((s.category || "NCS") !== category) return false;
      const a = assignmentOnDate(s, dateStr);
      return a && shiftFamily(a.shiftDef.code, shiftDefsByCode) === shift;
    }).length;
    return { category, minRequired: min, actual, met: actual >= min };
  });

  return {
    date: dateStr, shift, shiftName: SHIFT_NAME[shift],
    mandatoryFloorConfigured: rows.length > 0,
    categories: rows,
    allMet: rows.every(r => r.met),
  };
}

// ── 3. getShiftRoster ────────────────────────────────────────────────────────
async function getShiftRoster(args, ctx) {
  await assertOwnStation(ctx.actor, ctx.stationId);
  const { monthKey } = parseDateArg(args.date);
  const dateStr = args.date;
  const { roster, staff } = await findRosterGridReadOnly(ctx.stationId, monthKey);
  if (!roster) return { date: dateStr, rosterPublished: false, entries: [] };

  const entries = staff
    .map(s => ({ s, a: assignmentOnDate(s, dateStr) }))
    .filter(({ a }) => a)
    .filter(({ s }) => !args.category || s.category === args.category)
    .map(({ s, a }) => ({
      fullName: s.fullName, category: s.category || "NCS",
      shiftCode: a.shiftDef.code, shiftName: a.shiftDef.name,
      startTime: a.shiftDef.startTime, endTime: a.shiftDef.endTime,
    }));

  return { date: dateStr, rosterPublished: roster.isPublished, entries };
}

// ── 4. getDepartureManpower ──────────────────────────────────────────────────
async function getDepartureManpower(args, ctx) {
  const { year, month, day } = parseDateArg(args.date);
  const rows = await departureAllocationService.getDayAllocation(ctx.stationId, year, month, day, ctx.actor);
  return {
    date: args.date,
    departures: rows.map(r => ({
      flightRef: r.flightRef, depTime: r.depTime, shiftCode: r.shiftCode,
      releaser: r.releaser ? `${r.releaser.fullName} (${r.releaser.category})` : null,
      releaserUnfilledReason: r.releaserUnfilledReason,
      support: r.support ? r.support.fullName : null,
      supportUnfilledReason: r.supportUnfilledReason,
    })),
  };
}

// ── 5. getFlightScheduleSummary ──────────────────────────────────────────────
async function getFlightScheduleSummary(args, ctx) {
  await assertOwnStation(ctx.actor, ctx.stationId);
  const m = /^(\d{4})-(\d{2})$/.exec((args.month || "").trim());
  if (!m) throw ApiError.badRequest(`"${args.month}" isn't a YYYY-MM month`);
  const view = await flightScheduleService.getFlightScheduleView(ctx.stationId, +m[1], +m[2]);
  if (!view.imported) return { month: args.month, imported: false };
  return {
    month: args.month, imported: true,
    operatingDays: view.summary.operatingDays,
    totalMovements: view.summary.totalMovements,
    avgDailyMovements: view.summary.avgDailyMovements,
    peakDailyMovements: view.summary.peakDailyMovements,
    peakDate: view.summary.peakDate,
  };
}

// ── 6. getTaskMasterStatus ────────────────────────────────────────────────────
async function getTaskMasterStatus(args, ctx) {
  await assertOwnStation(ctx.actor, ctx.stationId);
  const [planned, unplanned] = await Promise.all([
    workloadConfigService.listPlannedTasks(ctx.stationId),
    workloadConfigService.listUnplannedTasks(ctx.stationId),
  ]);
  const zeroPlanned = planned.filter(t => !t.frequency).map(t => t.name);
  const zeroUnplanned = unplanned.filter(t => !t.avgFreqPerMonth).map(t => t.name);
  return {
    zeroFrequencyPlannedTasks: zeroPlanned,
    zeroFrequencyUnplannedTasks: zeroUnplanned,
    fullyConfigured: zeroPlanned.length === 0 && zeroUnplanned.length === 0,
  };
}

// ── 7. getComplianceStatus ───────────────────────────────────────────────────
// Real hard-rule violations against the PUBLISHED roster for the requested
// range, via ruleEngine.checkHardRuleCompliance — the exact function
// generation itself uses. Only ever evaluated against what's actually
// published; a range spanning more than one month checks each month's own
// published roster independently and combines the results.
async function getComplianceStatus(args, ctx) {
  await assertOwnStation(ctx.actor, ctx.stationId);
  const today = new Date();
  const defaultStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const startStr = args.dateRangeStart || defaultStart;
  const endStr = args.dateRangeEnd || args.dateRangeStart || defaultStart;
  const start = parseDateArg(startStr);
  const end = parseDateArg(endStr);

  const monthKeys = new Set([start.monthKey, end.monthKey]);
  const [rules, staffGroupMembersByGroupId, staffGroupNameById, { defs }] = await Promise.all([
    ruleBuilderService.listRules(ctx.stationId),
    ruleBuilderService.getStaffGroupMembersByGroupId(ctx.stationId),
    ruleBuilderService.getStaffGroupNameById(ctx.stationId),
    shiftDefsByCodeFlat(ctx.airlineId),
  ]);
  const ruleShiftDefsByCode = buildRuleShiftDefsByCode(defs);

  const allViolations = [];
  for (const monthKey of monthKeys) {
    const nDays = daysInMonth(monthKey);
    const { staff } = await findRosterGridReadOnly(ctx.stationId, monthKey);
    if (!staff.length) continue;
    // Same {userId,day,code} triple shape buildStaffWithShifts expects from
    // real generation output — built here from the real published grid
    // instead, so checkHardRuleCompliance sees exactly what's on the roster.
    const assignmentTriples = [];
    staff.forEach(s => {
      s.shiftAssignments.forEach(a => {
        const d = new Date(a.shiftDate);
        if (`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` === monthKey) {
          assignmentTriples.push({ userId: s.id, day: d.getUTCDate(), code: a.shiftDef.code });
        }
      });
    });
    const staffWithShifts = buildStaffWithShifts(staff, assignmentTriples, nDays);
    const violations = checkHardRuleCompliance(rules, staffWithShifts, nDays, ruleShiftDefsByCode, staffGroupMembersByGroupId, staffGroupNameById);
    violations.forEach(v => {
      const dateObj = dateAt(monthKey, v.day);
      const dateStr = dateObj.toISOString().slice(0, 10);
      if (dateStr < startStr || dateStr > endStr) return;
      const staffRow = staff.find(s => s.id === v.staff);
      allViolations.push({ date: dateStr, staffName: staffRow?.fullName || v.staff, shift: v.shift, rule: v.rule, reason: v.reason });
    });
  }

  return { dateRangeStart: startStr, dateRangeEnd: endStr, violationCount: allViolations.length, violations: allViolations };
}

// ── 8. getStaffNightCount ────────────────────────────────────────────────────
async function getStaffNightCount(args, ctx) {
  await assertOwnStation(ctx.actor, ctx.stationId);
  const resolved = await resolveOneStaffMember(args.staffName, ctx);
  if (resolved.error) return resolved;

  const start = parseDateArg(args.dateRangeStart);
  const end = parseDateArg(args.dateRangeEnd || args.dateRangeStart);
  const { flat: shiftDefsByCode } = await shiftDefsByCodeFlat(ctx.airlineId);

  const monthKeys = new Set();
  let cursor = new Date(Date.UTC(start.year, start.month - 1, 1));
  const endMonth = new Date(Date.UTC(end.year, end.month - 1, 1));
  while (cursor <= endMonth) {
    monthKeys.add(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  let nightCount = 0;
  const nightDates = [];
  for (const monthKey of monthKeys) {
    const { staff } = await findRosterGridReadOnly(ctx.stationId, monthKey);
    const row = staff.find(s => s.id === resolved.id);
    if (!row) continue;
    row.shiftAssignments.forEach(a => {
      const dateStr = new Date(a.shiftDate).toISOString().slice(0, 10);
      if (dateStr < args.dateRangeStart || dateStr > (args.dateRangeEnd || args.dateRangeStart)) return;
      if (shiftFamily(a.shiftDef.code, shiftDefsByCode) === "N") { nightCount++; nightDates.push(dateStr); }
    });
  }

  return {
    staffName: resolved.fullName, category: resolved.category,
    dateRangeStart: args.dateRangeStart, dateRangeEnd: args.dateRangeEnd || args.dateRangeStart,
    nightShiftCount: nightCount, nightDates,
  };
}

// ── 9. getLeaveForDate ───────────────────────────────────────────────────────
async function getLeaveForDate(args, ctx) {
  await assertOwnStation(ctx.actor, ctx.stationId);
  const staff = await rosterRepo.getActiveStaffForGeneration(ctx.stationId);
  const date = new Date(`${args.date}T00:00:00.000Z`);
  const leaves = await leaveRepo.approvedLeaveForStaffInRange(staff.map(s => s.id), date, date);
  const byId = new Map(staff.map(s => [s.id, s]));
  return {
    date: args.date,
    onLeave: leaves.map(l => ({ fullName: byId.get(l.userId)?.fullName || l.userId, category: byId.get(l.userId)?.category || "NCS" })),
  };
}

// ── 10. listStaff ─────────────────────────────────────────────────────────────
async function listStaff(args, ctx) {
  await assertOwnStation(ctx.actor, ctx.stationId);
  const staff = await rosterRepo.getActiveStaffForGeneration(ctx.stationId);
  const q = (args.nameQuery || "").trim().toLowerCase();
  const matches = staff.filter(s => (!q || s.fullName.toLowerCase().includes(q)) && (!args.category || s.category === args.category));
  return { matches: matches.map(s => ({ id: s.id, fullName: s.fullName, category: s.category || "NCS", designation: s.designation })) };
}

// Shared by any tool that takes a `staffName` — resolves it against the
// SAME real active-staff list listStaff() itself searches, so "who did you
// mean" behaves identically everywhere a name is typed.
async function resolveOneStaffMember(staffName, ctx) {
  const staff = await rosterRepo.getActiveStaffForGeneration(ctx.stationId);
  const q = (staffName || "").trim().toLowerCase();
  const matches = staff.filter(s => s.fullName.toLowerCase().includes(q));
  if (matches.length === 0) return { error: true, reason: `No active staff member matching "${staffName}" was found at this station.` };
  if (matches.length > 1) {
    return { error: true, reason: `More than one active staff member matches "${staffName}": ${matches.map(m => m.fullName).join(", ")}. Ask which one specifically.` };
  }
  return matches[0];
}

module.exports = {
  getCategoryRequirement, getMandatoryCoverageStatus, getShiftRoster, getDepartureManpower,
  getFlightScheduleSummary, getTaskMasterStatus, getComplianceStatus, getStaffNightCount,
  getLeaveForDate, listStaff,
};
