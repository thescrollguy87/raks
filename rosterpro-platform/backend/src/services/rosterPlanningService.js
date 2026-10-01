const rosterRepo = require("../repositories/rosterRepository");
const planningRepo = require("../repositories/rosterPlanningRepository");
const userRepo = require("../repositories/userRepository");
const leaveRepo = require("../repositories/leaveRepository");
const complianceService = require("./complianceService");
const auditTrail = require("../utils/auditTrail");
const ApiError = require("../utils/ApiError");
const { assertOwnStation, resolveAirlineId } = require("../utils/stationScope");
const { parseCycle } = require("../utils/shiftPatternCycle");

// ─── Shift Definitions (single-row CRUD — the Excel import/export pair in
// shiftDefinitionService.js already covers bulk, this covers the Shift
// Definitions tab's inline add/edit/delete-a-row flow) ───────────────────────
async function upsertShiftDefinition(input, actor, req) {
  const airlineId = await resolveAirlineId(actor, input.stationId);
  const def = await rosterRepo.upsertShiftDef(airlineId, input);
  await auditTrail.logActivity("Shift definition saved", `${def.code} — ${def.name}`, null, actor, req);
  return def;
}

async function deactivateShiftDefinition(id, actor, req, stationId) {
  const airlineId = await resolveAirlineId(actor, stationId);
  const def = await rosterRepo.findShiftDefById(airlineId, id);
  if (!def) throw ApiError.notFound("Shift definition not found");
  const updated = await rosterRepo.deactivateShiftDef(airlineId, id);
  await auditTrail.logActivity("Shift definition removed", `${def.code} — ${def.name}`, null, actor, req);
  return updated;
}

// ─── Shift Patterns ───────────────────────────────────────────────────────────
function listPatterns(stationId) {
  return planningRepo.findPatternsForStation(stationId);
}

async function upsertPattern(input, actor, req) {
  const pattern = await planningRepo.upsertPattern({ ...input, actorId: actor.sub });
  await auditTrail.logActivity("Shift pattern saved", `${pattern.code} — ${pattern.name} (${pattern.cycle})`, pattern.stationId, actor, req);
  return pattern;
}

async function deletePattern(id, actor, req) {
  const pattern = await planningRepo.findPatternById(id);
  if (!pattern) throw ApiError.notFound("Shift pattern not found");
  await assertOwnStation(actor, pattern.stationId);
  const deleted = await planningRepo.deletePattern(id);
  await auditTrail.logActivity("Shift pattern removed", `${pattern.code} — ${pattern.name}`, pattern.stationId, actor, req);
  return deleted;
}

// ─── Staff Allocation ─────────────────────────────────────────────────────────
// Every active staff member at the station, each merged with their
// allocation row if one exists — a staff member with none shown as
// MANUAL/no-pattern, matching the Staff Allocation tab's full roster table
// (it lists everyone, not just the already-configured).
async function listAllocations(stationId) {
  const [staff, allocations] = await Promise.all([
    rosterRepo.getActiveStaffForGeneration(stationId),
    planningRepo.findAllocationsForStation(stationId),
  ]);
  const byUserId = new Map(allocations.map(a => [a.userId, a]));
  return staff.map(s => {
    const alloc = byUserId.get(s.id);
    return {
      userId: s.id, fullName: s.fullName, category: s.category,
      patternId: alloc?.patternId || null,
      patternCode: alloc?.pattern?.code || null,
      cycleStartDay: alloc?.cycleStartDay ?? 0,
    };
  });
}

async function upsertAllocation(input, actor, req) {
  const target = await userRepo.findStationId(input.userId);
  if (!target) throw ApiError.notFound("Staff member not found");
  await assertOwnStation(actor, target.stationId);
  const alloc = await planningRepo.upsertAllocation({ ...input, actorId: actor.sub });
  await auditTrail.logActivity("Staff shift allocation saved", `userId ${input.userId} -> pattern ${input.patternId || "MANUAL"}`, null, actor, req);
  return alloc;
}

// ─── Workload Items ───────────────────────────────────────────────────────────
function listWorkloadItems(stationId) {
  return planningRepo.findWorkloadItemsForStation(stationId);
}

async function upsertWorkloadItem(input, actor, req) {
  const item = await planningRepo.upsertWorkloadItem({ ...input, actorId: actor.sub });
  await auditTrail.logActivity("Workload item saved", `${item.section} — ${item.label}`, item.stationId, actor, req);
  return item;
}

async function deleteWorkloadItem(id, actor, req) {
  const item = await planningRepo.findWorkloadItemById(id);
  if (!item) throw ApiError.notFound("Workload item not found");
  await assertOwnStation(actor, item.stationId);
  const deleted = await planningRepo.deleteWorkloadItem(id);
  await auditTrail.logActivity("Workload item removed", `${item.section} — ${item.label}`, item.stationId, actor, req);
  return deleted;
}

// ─── Manpower Plan (Generate tab's "Calculate" step) ─────────────────────────
// Previously computed from the standalone `workload_items` table
// (planningRepo.findWorkloadItemsForStation) via utils/manpowerPlanning.js —
// a leftover from before the Segment F rewrite replaced that mechanism with
// the real Workload Config tab (Task Masters, Concurrent Movement Ratios,
// Manual Demand, Flight-Schedule-derived demand). There is no UI left that
// writes to `workload_items` (the "Workload Input tab" it pointed to doesn't
// exist anymore), so that table is permanently empty for every real
// station, which made this panel always report zero/near-default numbers
// and "not configured" regardless of what a station had actually set up in
// Workload Config. Rebuilt on rosterGenerationService.buildWorkloadContext
// — the exact same real computation generation itself uses (and that the
// Generate tab's "Real Requirement — Average vs Peak Day" table already
// renders correctly) — so this panel can no longer disagree with what
// generation actually does.
async function getManpowerPlan(stationId, monthKey, aogBuffer = 0, actor) {
  // Required lazily to avoid a load-order issue: rosterGenerationService.js
  // is otherwise unrelated to this file and doesn't require it back.
  const rosterGenerationService = require("./rosterGenerationService");
  const airlineId = await resolveAirlineId(actor, stationId);

  const nDays = rosterGenerationService.daysInMonth(monthKey);
  const monthStart = rosterGenerationService.dateAt(monthKey, 1);
  const monthEnd = rosterGenerationService.dateAt(monthKey, nDays);

  const [workloadContext, staff] = await Promise.all([
    rosterGenerationService.buildWorkloadContext(stationId, monthKey, undefined, aogBuffer, airlineId),
    rosterRepo.getActiveStaffForGeneration(stationId),
  ]);
  const [summaries, leaves] = await Promise.all([
    Promise.all(staff.map(s => complianceService.getComplianceSummary(s.id))),
    leaveRepo.approvedLeaveForStaffInRange(staff.map(s => s.id), monthStart, monthEnd),
  ]);
  const blockedIds = new Set(staff.filter((s, i) => summaries[i].isBlocked).map(s => s.id));
  // Approved leave anywhere in the month takes a staff member out of this
  // month's effective headcount, same binary treatment as compliance
  // blocking — this panel is a monthly snapshot, not a day-by-day
  // availability check, so "on leave for part of the month" reduces the
  // count exactly like "compliance-blocked" already does, rather than
  // being silently ignored (previously only compliance blocking was
  // subtracted; a staff member on a confirmed 2-week approved leave still
  // counted as fully available).
  const onLeaveIds = new Set(leaves.map(l => l.userId));
  const unavailableIds = new Set([...blockedIds, ...onLeaveIds]);

  const staffByCategory = {};
  for (const s of staff) {
    if (unavailableIds.has(s.id)) continue;
    const cat = s.category || "NCS";
    staffByCategory[cat] = (staffByCategory[cat] || 0) + 1;
  }

  // For each shift, find the SINGLE day whose combined B1+B2+CM+NCS demand
  // is highest, and use THAT day's actual per-category numbers — not each
  // category's own independently-worst day. Each category previously took
  // its own peak day in isolation (B1's worst day might be the 5th, CM's
  // the 12th, NCS's the 20th), then those independent peaks were summed as
  // if all four categories' worst cases landed on the same shift at once,
  // which overstated Grand Needed well above any day that actually occurs.
  const peak = {}, target = {}, peakDay = {};
  ["M", "A", "N"].forEach(sh => {
    let bestDay = 1, bestTotal = -1;
    for (let d = 1; d <= nDays; d++) {
      const dd = workloadContext.advisoryDemand[d]?.[sh] || { B1: 0, B2: 0, CM: 0, NCS: 0 };
      const combined = (dd.B1 || 0) + (dd.B2 || 0) + (dd.CM || 0) + (dd.NCS || 0);
      if (combined > bestTotal) { bestTotal = combined; bestDay = d; }
    }
    const dd = workloadContext.advisoryDemand[bestDay]?.[sh] || { B1: 0, B2: 0, CM: 0, NCS: 0 };
    peak[sh] = { b1: dd.B1 || 0, b2: dd.B2 || 0, cm: dd.CM || 0, ncs: dd.NCS || 0 };
    target[sh] = peak[sh].b1 + peak[sh].b2 + peak[sh].cm + peak[sh].ncs;
    peakDay[sh] = bestDay;
  });
  const grandNeeded = target.M + target.A + target.N;
  const effectiveStaff = Math.max(0, staff.length - unavailableIds.size);

  // One-line, human-readable trace of which single day drove each shift's
  // combined peak — a planner can see all four categories' numbers come
  // from the SAME day, not four different worst-case days stitched together.
  function formatExplain(sh) {
    const d = peakDay[sh];
    const dd = workloadContext.advisoryDemand[d]?.[sh] || { B1: 0, B2: 0, CM: 0, NCS: 0 };
    return `Day ${d}: highest combined demand this shift = B1 ${dd.B1 || 0} + B2 ${dd.B2 || 0} + CM ${dd.CM || 0} + NCS ${dd.NCS || 0} = ${target[sh]}.`;
  }
  const explainByShift = { M: formatExplain("M"), A: formatExplain("A"), N: formatExplain("N") };

  const CAT_KEY = { B1: "b1", B2: "b2", CM: "cm", NCS: "ncs", STO: null };
  const categoryRequirement = Object.entries(CAT_KEY).map(([cat, key]) => {
    const needs = key ? { M: peak.M[key], A: peak.A[key], N: peak.N[key] } : { M: 0, A: 0, N: 0 };
    const available = staffByCategory[cat] || 0;
    const maxNeed = Math.max(needs.M, needs.A, needs.N, 0);
    const explain = key ? explainByShift : null;
    return { category: cat, needs, available, status: available >= maxNeed ? "OK" : "SHORT", explain };
  });

  // Real, currently-configured workload feeding the numbers above — Flight
  // Schedule occurrences, Planned/Unplanned Task Master hours, Manual
  // Demand — each row only shown when actually configured/non-zero.
  const round1 = n => Math.round((n || 0) * 10) / 10;
  const workloadSummary = [];
  const fs = workloadContext.flightSummary;
  if ((workloadContext.transitOccurrences + workloadContext.pdcOccurrences) > 0) {
    workloadSummary.push({
      label: "Flight Schedule — Transit + PDC",
      count: workloadContext.transitOccurrences + workloadContext.pdcOccurrences,
      note: `${fs.operatingDays || 0} operating day(s), ${fs.totalMovements || 0} movement(s) this month`,
    });
  }
  const pd = workloadContext.plannedDemand;
  if (pd.totalHours > 0) {
    workloadSummary.push({
      label: "Planned Maintenance Tasks", count: pd.totalHours, unit: "h",
      b1: round1(pd.byCategory.B1), b2: round1(pd.byCategory.B2), cm: round1(pd.byCategory.CM), ncs: round1(pd.byCategory.NCS),
    });
  }
  const ud = workloadContext.unplannedDemand;
  if (ud.totalHours > 0) {
    workloadSummary.push({
      label: "Unplanned Workload (incl. buffer)", count: ud.totalHours, unit: "h",
      b1: round1(ud.byCategory.B1), b2: round1(ud.byCategory.B2), cm: round1(ud.byCategory.CM), ncs: round1(ud.byCategory.NCS),
    });
  }
  const mad = workloadContext.manualAdditionalDemand;
  if (mad.B1 + mad.B2 + mad.CM + mad.NCS > 0) {
    workloadSummary.push({
      label: "Manual Demand Entries", count: mad.B1 + mad.B2 + mad.CM + mad.NCS,
      b1: mad.B1, b2: mad.B2, cm: mad.CM, ncs: mad.NCS,
    });
  }

  return {
    peak, target, peakDay, grandNeeded, effectiveStaff,
    blockedCount: blockedIds.size, onLeaveCount: onLeaveIds.size,
    sufficient: effectiveStaff >= grandNeeded,
    shortfall: Math.max(0, grandNeeded - effectiveStaff),
    categoryRequirement, workloadSummary,
    // Real per-shift headcount the AOG Buffer input actually added (same
    // across all 4 categories and all 3 shifts, by design — see
    // buildWorkloadContext's own note on the N-days-to-man-hours
    // conversion) — the CSV export's "AOG Buffer" column previously always
    // showed blank because this was never returned, only computed and
    // folded into the demand numbers above without being exposed.
    aogPerShift: workloadContext.aogPerShift,
    flightScheduleFallback: workloadContext.flightScheduleFallback,
  };
}

module.exports = {
  upsertShiftDefinition, deactivateShiftDefinition,
  listPatterns, upsertPattern, deletePattern,
  listAllocations, upsertAllocation,
  listWorkloadItems, upsertWorkloadItem, deleteWorkloadItem,
  getManpowerPlan,
  parseCycle,
};
