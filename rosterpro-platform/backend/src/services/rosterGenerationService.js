const rosterRepo = require("../repositories/rosterRepository");
const leaveRepo = require("../repositories/leaveRepository");
const planningRepo = require("../repositories/rosterPlanningRepository");
const complianceService = require("./complianceService");
const workloadConfigService = require("./workloadConfigService");
const ruleBuilderService = require("./ruleBuilderService");
const flightScheduleService = require("./flightScheduleService");
const auditTrail = require("../utils/auditTrail");
const ApiError = require("../utils/ApiError");
const { buildRosterAssignments } = require("../utils/rosterGenerationAlgorithm");
const { parseCycle } = require("../utils/shiftPatternCycle");
const { computeFlightWorkloadSummary } = require("../utils/flightScheduleParser");
const {
  computeDailyShiftDemand, computeTaskMasterDemand, computeUnplannedWorkload,
  computeExplainableManpower, getManualDemandByDayShift, computeAveragePeakByShift,
  buildTransitWorkloadEvents, buildPDCWorkloadEvents, buildClashEvents,
  computeDailyPeaks, computeAutomaticClashes,
} = require("../utils/workloadEngine");
const { checkHardRuleCompliance, computeSoftRuleScore } = require("../utils/ruleEngine");

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function dateAt(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function yearMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return { year: y, month: m };
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
// `usePatterns` branch reading PATTERNS/ALLOCATIONS. Every key present in
// the returned map is, by definition, a staff member on an approved (not
// MANUAL) pattern — exactly the LMPM-lock population the generator must
// never pull off their pattern's OFF day, even under coverage pressure.
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

// Gathers everything the Workload Config / Rule Builder / Flight Schedule
// tabs feed into generation: the Mandatory Minimum Coverage grid, the
// enabled night_only/no_night hard rules (for proactive enforcement) plus
// the full rule set (for the post-generation compliance/score panels), the
// real flight-schedule-driven advisory demand for this exact month (falling
// back cleanly to flat base coverage + Manual Demand when nothing has been
// imported for it), and the Staff Group lookups rules scoped by group need.
async function buildWorkloadContext(stationId, monthKey, mandatoryCoverageConfigOverride) {
  const { year, month } = yearMonth(monthKey);
  const nDays = daysInMonth(monthKey);

  const [config, mandatoryCoverageConfig, rules, staffGroupMembersByGroupId, staffGroupNameById,
    plannedTasks, unplannedTasks, manualDemandEntries, flightSchedule, allShiftDefs, station] = await Promise.all([
    workloadConfigService.getWorkloadConfig(stationId),
    mandatoryCoverageConfigOverride || workloadConfigService.getMandatoryCoverageConfigForGeneration(stationId),
    ruleBuilderService.listRules(stationId),
    ruleBuilderService.getStaffGroupMembersByGroupId(stationId),
    ruleBuilderService.getStaffGroupNameById(stationId),
    workloadConfigService.listPlannedTasks(stationId),
    workloadConfigService.listUnplannedTasks(stationId),
    workloadConfigService.listManualDemand(stationId, monthKey),
    flightScheduleService.getFlightScheduleForMonth(stationId, year, month),
    rosterRepo.findAllShiftDefs(),
    rosterRepo.findStationById(stationId),
  ]);

  const shiftDefsFull = {};
  ["M", "A", "N"].forEach(code => {
    const def = allShiftDefs.find(d => d.code === code);
    if (def) shiftDefsFull[code] = { start: def.startTime, end: def.endTime, type: def.type };
  });

  const baseCoverage = {};
  ["M", "A", "N"].forEach(sh => {
    const cfg = mandatoryCoverageConfig?.B1?.[sh];
    baseCoverage[sh] = cfg?.enabled ? Math.max(1, +cfg.min || 1) : 0;
  });
  const perShiftBuffer = { B1: config.bufferB1, B2: config.bufferB2, CM: config.bufferCM, NCS: config.bufferNCS };

  const demandResult = computeDailyShiftDemand({
    year, month, homeStation: station?.iataCode, baseCoverage,
    flightSchedule: flightSchedule ? { turnRecords: flightSchedule.turnRecords, charterRecords: flightSchedule.charterRecords } : null,
    config, manualDemandEntries, shiftDefs: shiftDefsFull, perShiftBuffer,
  });

  // B2 advisory sizing comes ONLY from Manual Demand, never from
  // flight-schedule-driven peak concurrency — computeDailyShiftDemand's own
  // demand object deliberately has no B2 key for that reason.
  const manualByDayShift = getManualDemandByDayShift(manualDemandEntries, year, month, shiftDefsFull);
  const advisoryDemand = {};
  for (let d = 1; d <= nDays; d++) {
    advisoryDemand[d] = {};
    ["M", "A", "N"].forEach(sh => {
      advisoryDemand[d][sh] = {
        B1: demandResult.demand[d][sh].B1,
        CM: demandResult.demand[d][sh].CM,
        NCS: demandResult.demand[d][sh].NCS,
        B2: manualByDayShift[d]?.[sh]?.B2 || 0,
      };
    });
  }

  const nightRestrictionRules = rules.filter(r => r.enabled && r.type === "hard" && (r.conditionType === "night_only" || r.conditionType === "no_night"));

  const flightSummary = flightSchedule
    ? computeFlightWorkloadSummary(flightSchedule.turnRecords, flightSchedule.charterRecords, year, month)
    : { totalMovements: 0, operatingDays: 0, daysInMonth: nDays };
  const plannedDemand = computeTaskMasterDemand(plannedTasks, nDays, flightSummary.operatingDays);
  const unplannedDemand = computeUnplannedWorkload(unplannedTasks, config, plannedDemand.totalHours);
  const explainableManpower = computeExplainableManpower(flightSummary, plannedDemand, unplannedDemand, nDays);
  const averagePeakByShift = computeAveragePeakByShift(demandResult.demand, nDays);

  // Automatic clash detection + real Transit/PDC occurrence counts — only
  // meaningful once a flight schedule actually exists for this month;
  // otherwise there are no departure times to derive any of this from.
  let automaticClashes = { clashDays: [], peakSimultaneous: 0, peakDate: null, peakFlights: [] };
  let transitOccurrences = 0, pdcOccurrences = 0, peakSimultaneousTransit = 0, peakSimultaneousTransitDate = null;
  if (flightSchedule) {
    const homeStation = station?.iataCode;
    const transitEvents = buildTransitWorkloadEvents(flightSchedule.turnRecords, year, month, homeStation, config);
    const pdcEvents = buildPDCWorkloadEvents(flightSchedule.turnRecords, flightSchedule.charterRecords, year, month, homeStation, config);
    const clashEvents = buildClashEvents(flightSchedule.turnRecords, flightSchedule.charterRecords, year, month, homeStation, config);
    transitOccurrences = transitEvents.length;
    pdcOccurrences = pdcEvents.length;
    const transitPeaks = computeDailyPeaks(transitEvents);
    peakSimultaneousTransit = transitPeaks.monthPeak;
    peakSimultaneousTransitDate = transitPeaks.monthPeakDay?.date || null;
    automaticClashes = computeAutomaticClashes(clashEvents);
  }

  const manualAdditionalDemand = { B1: 0, B2: 0, CM: 0, NCS: 0 };
  manualDemandEntries.forEach(m => {
    manualAdditionalDemand.B1 += (+m.reqB1 || 0);
    manualAdditionalDemand.B2 += (+m.reqB2 || 0);
    manualAdditionalDemand.CM += (+m.reqCM || 0);
    manualAdditionalDemand.NCS += (+m.reqNCS || 0);
  });

  return {
    mandatoryCoverageConfig, nightRestrictionRules, allRules: rules,
    staffGroupMembersByGroupId, staffGroupNameById,
    advisoryDemand, demandSource: demandResult.source, demandReason: demandResult.reason,
    explainableManpower, plannedDemand, unplannedDemand, flightSummary, averagePeakByShift,
    automaticClashes, transitOccurrences, pdcOccurrences, peakSimultaneousTransit, peakSimultaneousTransitDate,
    manualAdditionalDemand, config,
  };
}

function buildStaffWithShifts(staff, assignments, nDays) {
  const codesByUser = {};
  for (const a of assignments) { (codesByUser[a.userId] ??= new Array(nDays))[a.day - 1] = a.code; }
  return staff.map(s => ({ id: s.id, category: s.category, shifts: codesByUser[s.id] || [] }));
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

  const [leaves, complianceSummaries, shiftDefs, tailByUser, patternByUser, workloadContext] = await Promise.all([
    leaveRepo.approvedLeaveForStaffInRange(staff.map(s => s.id), monthStart, monthEnd),
    Promise.all(staff.map(s => complianceService.getComplianceSummary(s.id))),
    rosterRepo.findAllShiftDefs(),
    continueFromPrevious ? buildContinuationTails(stationId, monthKey, staff) : Promise.resolve(undefined),
    usePatterns ? buildPatternByUser(stationId, staff) : Promise.resolve(undefined),
    buildWorkloadContext(stationId, monthKey),
  ]);

  const blockedUserIds = staff.filter((s, i) => complianceSummaries[i].isBlocked).map(s => s.id);
  const leaveByUserDay = applyLeave ? buildLeaveByUserDay(leaves, monthKey, nDays) : {};
  const shiftDefsByCode = Object.fromEntries(shiftDefs.map(d => [d.code, d.type]));
  // Every staff member with a real (non-MANUAL) pattern assignment is locked
  // to it — never pulled onto a shift on their pattern's OFF day, even to
  // patch a coverage gap. usePatterns=false means nobody is in this set,
  // matching the pre-pattern-mode behavior exactly.
  const lmpmLockedUserIds = usePatterns ? Object.keys(patternByUser || {}) : [];

  const { assignments, violations, advisoryGaps } = buildRosterAssignments({
    staff, nDays, leaveByUserDay, blockedUserIds, tailByUser, patternByUser, shiftDefsByCode,
    mandatoryCoverageConfig: workloadContext.mandatoryCoverageConfig,
    lmpmLockedUserIds,
    nightRestrictionRules: workloadContext.nightRestrictionRules,
    staffGroupMembersByGroupId: workloadContext.staffGroupMembersByGroupId,
    advisoryDemand: workloadContext.advisoryDemand,
  });

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

  // Explainable Workload Analysis + Soft Rule Optimization Score panels —
  // read-only analysis of the just-computed plan, shown on the Generate tab
  // whether or not it's actually persisted yet.
  const staffWithShifts = buildStaffWithShifts(staff, assignments, nDays);
  const isPatternLocked = s => lmpmLockedUserIds.includes(s.id);
  const hardRuleViolations = checkHardRuleCompliance(
    workloadContext.allRules, staffWithShifts, nDays, shiftDefsByCode,
    workloadContext.staffGroupMembersByGroupId, workloadContext.staffGroupNameById,
  );
  const softRuleScore = computeSoftRuleScore(
    workloadContext.allRules, staffWithShifts, nDays, usePatterns, isPatternLocked, shiftDefsByCode,
    workloadContext.staffGroupMembersByGroupId, workloadContext.staffGroupNameById,
  );
  const fs = workloadContext.flightSummary;
  const avgDailyTransit = fs.operatingDays ? Math.round((workloadContext.transitOccurrences / fs.operatingDays) * 10) / 10 : 0;
  const analysis = {
    demandSource: workloadContext.demandSource, demandReason: workloadContext.demandReason,
    flightWorkload: {
      operatingDays: fs.operatingDays || 0, daysInMonth: fs.daysInMonth || nDays,
      totalMovements: fs.totalMovements || 0, avgDailyMovements: fs.avgDailyMovements || 0,
      transitOccurrences: workloadContext.transitOccurrences, avgDailyTransit,
      peakSimultaneousTransit: workloadContext.peakSimultaneousTransit, peakSimultaneousTransitDate: workloadContext.peakSimultaneousTransitDate,
      pdcOccurrences: workloadContext.pdcOccurrences,
      peakDepartureClash: workloadContext.automaticClashes.peakSimultaneous, peakDepartureClashDate: workloadContext.automaticClashes.peakDate,
      manualAdditionalDemand: workloadContext.manualAdditionalDemand,
    },
    automaticClashes: workloadContext.automaticClashes,
    plannedMaintenance: {
      expectedManpowerHours: workloadContext.plannedDemand.totalHours,
      byCategory: workloadContext.plannedDemand.byCategory, byShift: workloadContext.plannedDemand.byShift,
    },
    unplannedWorkload: { ...workloadContext.unplannedDemand, bufferPct: workloadContext.config.unplannedBufferPct },
    manpowerRequirement: workloadContext.explainableManpower,
    averagePeakByShift: workloadContext.averagePeakByShift,
    hardRuleViolations, softRuleScore,
  };

  if (preview) {
    return {
      preview: true, staffCount: staff.length, blockedCount: blockedUserIds.length,
      assignmentCount: assignments.length, violations, advisoryGaps, manpowerByShift, analysis,
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
    `${stationId} — ${monthKey}: ${staff.length} staff, ${blockedUserIds.length} blocked, ${violations.length} critical gap(s), ${advisoryGaps.length} advisory gap(s)`,
    stationId, actor, req
  );

  return {
    roster, staffCount: staff.length, blockedCount: blockedUserIds.length,
    assignmentCount: assignments.length, violations, advisoryGaps, manpowerByShift, analysis,
  };
}

module.exports = { generateRoster, buildLeaveByUserDay };
