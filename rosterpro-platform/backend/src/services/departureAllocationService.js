const repo = require("../repositories/departureAllocationRepository");
const rosterRepo = require("../repositories/rosterRepository");
const leaveRepo = require("../repositories/leaveRepository");
const complianceService = require("./complianceService");
const flightScheduleService = require("./flightScheduleService");
const workloadConfigService = require("./workloadConfigService");
const auditTrail = require("../utils/auditTrail");
const ApiError = require("../utils/ApiError");
const { assertOwnStation } = require("../utils/stationScope");
const { expandOperatingDates, minutesToHHMM } = require("../utils/flightScheduleParser");
const { resolveRosterShiftForDeparture, allocateDepartureManpower } = require("../utils/departureAllocationEngine");

// Builds the day's departure events straight from the imported Turn Report
// / Charter rows — a "departure" only exists where an outbound/charter
// departure TIME is actually known; an inbound-only turn row (no outbound
// leg) has nothing to allocate manpower against.
async function buildDayDepartures(stationId, year, month, day) {
  const flightSchedule = await flightScheduleService.getFlightScheduleForMonth(stationId, year, month);
  if (!flightSchedule) return [];
  // UTC-based, matching the `date` field's own Date.UTC(...) construction
  // in getDayAllocation/autoAllocateDay below — the two dateKeys must agree
  // exactly since the frontend uses this key to look up its own assignment.
  const dateKey = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  const departures = [];

  flightSchedule.turnRecords.forEach(rec => {
    if (rec.outboundDepMin === null) return;
    const dates = expandOperatingDates(rec.effectiveDate, rec.discontinueDate, rec.daysOfWeek, year, month);
    if (!dates.some(d => d.getDate() === day)) return;
    departures.push({
      key: `turn:${rec.id}:${dateKey}`, eventType: "turn", eventId: rec.id,
      depMin: rec.outboundDepMin, flightRef: `${rec.inboundFlt || "-"} / ${rec.outboundFlt || "-"}`,
      route: `${rec.inboundDepSta || "-"}→${rec.inboundArrSta || "-"}→${rec.outboundArrSta || "-"}`,
    });
  });
  flightSchedule.charterRecords.forEach(rec => {
    if (rec.depMin === null) return;
    const dates = expandOperatingDates(rec.effectiveDate, rec.discontinueDate, rec.daysOfWeek, year, month);
    if (!dates.some(d => d.getDate() === day)) return;
    departures.push({
      key: `charter:${rec.id}:${dateKey}`, eventType: "charter", eventId: rec.id,
      depMin: rec.depMin, flightRef: rec.flightDesg || "-", route: `${rec.depSta || "-"}→${rec.arrSta || "-"}`,
    });
  });

  departures.sort((a, b) => a.depMin - b.depMin);
  return departures;
}

async function loadShiftDefsFull() {
  const allShiftDefs = await rosterRepo.findAllShiftDefs();
  const shiftDefsFull = {};
  ["M", "A", "N"].forEach(code => {
    const def = allShiftDefs.find(d => d.code === code);
    if (def) shiftDefsFull[code] = { start: def.startTime, end: def.endTime, type: def.type };
  });
  return shiftDefsFull;
}

function addUTCDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

// THE function that enforces "allocate only from the real shift roster":
// resolves each departure to the exact real roster row that covers it —
// Morning/Afternoon on the departure's own calendar date, or (for an
// overnight Night shift) either that date's own Night crew or the
// PREVIOUS date's Night crew, whichever one's actual duty window the
// departure time falls inside (see resolveRosterShiftForDeparture) — then
// looks up who is genuinely assigned that shift, minus anyone blocked
// (expired qualification/license) or on approved leave that specific
// date. Two departures that resolve to the same real shift+date share the
// exact same pool (and, in the engine, the same round-robin rotator);
// departures resolving to different shifts never draw from each other's
// crews. A departure with no roster at all for its resolved shift+date
// gets an empty pool — never silently borrowed from elsewhere.
async function resolveDeparturePools(stationId, departures, dayDate) {
  const shiftDefsFull = await loadShiftDefsFull();
  const resolved = departures.map(dep => {
    const r = resolveRosterShiftForDeparture(dep.depMin, shiftDefsFull);
    if (!r) return { ...dep, shiftCode: null, rosterDate: null, poolKey: null };
    const rosterDate = addUTCDays(dayDate, r.dayOffset);
    return { ...dep, shiftCode: r.shiftCode, rosterDate, poolKey: `${r.shiftCode}:${rosterDate.toISOString().slice(0, 10)}` };
  });

  const distinctByKey = new Map();
  resolved.forEach(d => { if (d.poolKey && !distinctByKey.has(d.poolKey)) distinctByKey.set(d.poolKey, d); });
  const distinctKeys = [...distinctByKey.values()];

  const rowsByKey = {};
  await Promise.all(distinctKeys.map(async d => {
    rowsByKey[d.poolKey] = await rosterRepo.findAssignmentsByStationDateShift(stationId, d.rosterDate, d.shiftCode);
  }));

  // Blocked-staff and leave checks run ONCE across the union of everyone
  // who showed up in any pool — the same person can legitimately appear
  // in more than one resolved shift+date (e.g. picked up an extra shift),
  // and re-checking them per key would just repeat the same DB calls.
  const allRows = Object.values(rowsByKey).flat();
  const allUserIds = [...new Set(allRows.map(r => r.userId))];
  const distinctDateStrs = [...new Map(distinctKeys.map(d => [d.rosterDate.toISOString().slice(0, 10), d.rosterDate])).entries()];

  const [complianceResults, leaveResults] = await Promise.all([
    Promise.all(allUserIds.map(async id => [id, (await complianceService.getComplianceSummary(id)).isBlocked])),
    Promise.all(distinctDateStrs.map(async ([dateStr, dateObj]) => [dateStr, await leaveRepo.approvedLeaveForStaffInRange(allUserIds, dateObj, dateObj)])),
  ]);
  const blockedSet = new Set(complianceResults.filter(([, blocked]) => blocked).map(([id]) => id));
  const leaveByDate = Object.fromEntries(leaveResults.map(([dateStr, rows]) => [dateStr, new Set(rows.map(l => l.userId))]));

  const poolByKey = {};
  distinctKeys.forEach(d => {
    const dateStr = d.rosterDate.toISOString().slice(0, 10);
    const onLeave = leaveByDate[dateStr] || new Set();
    const eligible = (rowsByKey[d.poolKey] || []).filter(r => !blockedSet.has(r.userId) && !onLeave.has(r.userId));
    const byCat = { B1: [], CM: [], NCS: [] };
    eligible.forEach(r => { if (byCat[r.user.category]) byCat[r.user.category].push({ id: r.user.id, fullName: r.user.fullName, category: r.user.category }); });
    poolByKey[d.poolKey] = byCat;
  });

  return resolved.map(dep => ({ ...dep, pools: dep.poolKey ? poolByKey[dep.poolKey] : { B1: [], CM: [], NCS: [] } }));
}

// Merges the day's real departures with whatever's already assigned in the
// database, plus each departure's real roster-eligible pool (so the
// frontend's manual-override dropdowns only ever offer staff genuinely on
// duty at that moment — the same constraint auto-allocate itself uses).
//
// reasonOverrides (optional): { [key]: { releaserUnfilledReason,
// supportUnfilledReason } } — the EXACT reasons autoAllocateDay's engine
// run just computed, for departures reported by this same call. Without
// an override, an unfilled slot's reason is inferred from pool size alone
// (empty pool -> "no_one_rostered", non-empty pool -> "all_busy_with_clash"
// as the best available explanation) — a reasonable approximation for a
// plain page load where no allocation was just attempted, but not as
// precise as the real clash computation.
async function getDayAllocation(stationId, year, month, day, actor, reasonOverrides = {}) {
  assertOwnStation(actor, stationId);
  const date = new Date(Date.UTC(year, month - 1, day));
  const [departures, existingRows] = await Promise.all([
    buildDayDepartures(stationId, year, month, day),
    repo.listForDate(stationId, date),
  ]);
  const existingByKey = {};
  existingRows.forEach(r => { existingByKey[`${r.eventType}:${r.eventId}:${date.toISOString().slice(0, 10)}`] = r; });

  const resolved = await resolveDeparturePools(stationId, departures, date);

  return resolved.map(dep => {
    const existing = existingByKey[dep.key];
    const eligibleReleasers = [...dep.pools.B1, ...dep.pools.CM];
    const override = reasonOverrides[dep.key];
    const releaserUnfilledReason = existing?.releaser ? null
      : (override ? override.releaserUnfilledReason : (eligibleReleasers.length === 0 ? "no_one_rostered" : "all_busy_with_clash"));
    const supportUnfilledReason = existing?.support ? null
      : (override ? override.supportUnfilledReason : (dep.pools.NCS.length === 0 ? "no_one_rostered" : "all_busy_with_clash"));
    return {
      key: dep.key, eventType: dep.eventType, eventId: dep.eventId, flightRef: dep.flightRef, route: dep.route,
      depTime: minutesToHHMM(dep.depMin),
      shiftCode: dep.shiftCode, rosterDate: dep.rosterDate ? dep.rosterDate.toISOString().slice(0, 10) : null,
      releaser: existing?.releaser ? { id: existing.releaser.id, fullName: existing.releaser.fullName, category: existing.releaserCategory } : null,
      support: existing?.support ? { id: existing.support.id, fullName: existing.support.fullName } : null,
      eligibleReleasers, eligibleSupport: dep.pools.NCS,
      releaserUnfilledReason, supportUnfilledReason,
    };
  });
}

// Auto-allocates every still-unassigned departure on the day, drawing
// EXCLUSIVELY from each departure's real roster-shift crew (never the
// whole station) — a manual pick already on file is preserved untouched
// (never silently overwritten by re-running this).
async function autoAllocateDay(stationId, year, month, day, actor, req) {
  assertOwnStation(actor, stationId);
  const date = new Date(Date.UTC(year, month - 1, day));
  const [departures, existingRows, config] = await Promise.all([
    buildDayDepartures(stationId, year, month, day),
    repo.listForDate(stationId, date),
    workloadConfigService.getWorkloadConfig(stationId),
  ]);
  if (departures.length === 0) return [];

  const resolved = await resolveDeparturePools(stationId, departures, date);
  const dateKey = date.toISOString().slice(0, 10);
  const existingByKey = {};
  existingRows.forEach(r => {
    if (!r.releaserUserId && !r.supportUserId) return;
    existingByKey[`${r.eventType}:${r.eventId}:${dateKey}`] = {
      releaserUserId: r.releaserUserId, releaserCategory: r.releaserCategory, supportUserId: r.supportUserId,
    };
  });

  const engineInput = resolved.map(dep => ({
    key: dep.key, depMin: dep.depMin, poolKey: dep.poolKey || `none:${dep.key}`,
    releaserB1: dep.pools.B1.map(s => s.id), releaserCM: dep.pools.CM.map(s => s.id), supportNCS: dep.pools.NCS.map(s => s.id),
  }));
  const allocations = allocateDepartureManpower(engineInput, config.clashProximityMinutes, existingByKey);
  const byKey = {};
  departures.forEach(d => { byKey[d.key] = d; });

  await repo.bulkUpsert(allocations.map(a => ({
    stationId, date, eventType: byKey[a.key].eventType, eventId: byKey[a.key].eventId, flightRef: byKey[a.key].flightRef,
    releaserUserId: a.releaserUserId, releaserCategory: a.releaserCategory, supportUserId: a.supportUserId, actorId: actor.sub,
  })));

  const unfilledCount = allocations.filter(a => a.unfilled).length;
  await auditTrail.logActivity(
    "Departure manpower auto-allocated",
    `${dateKey}: ${allocations.length} departure(s), ${unfilledCount} unfilled (drawn from the real shift roster only)`,
    stationId, actor, req,
  );

  // Carries the engine's own precise reasons through to the response this
  // call returns, rather than getDayAllocation's own pool-size heuristic —
  // exact for the run that just happened.
  const reasonOverrides = {};
  allocations.forEach(a => {
    reasonOverrides[a.key] = { releaserUnfilledReason: a.releaserUnfilledReason, supportUnfilledReason: a.supportUnfilledReason };
  });
  return getDayAllocation(stationId, year, month, day, actor, reasonOverrides);
}

// Manual override for exactly one departure — set releaserUserId/
// supportUserId to null to clear that slot. Does NOT itself re-validate
// that the chosen person is on the resolved shift (the frontend only ever
// offers eligibleReleasers/eligibleSupport as options), but a
// station-scoped actor picking a real user id at their own station is not
// a security boundary this needs to re-enforce server-side beyond that.
async function manualAssign(input, actor, req) {
  const { stationId, year, month, day, eventType, eventId, flightRef, releaserUserId, releaserCategory, supportUserId } = input;
  assertOwnStation(actor, stationId);
  if (releaserUserId && releaserCategory !== "B1" && releaserCategory !== "CM") {
    throw ApiError.badRequest("releaserCategory must be B1 or CM when a releaser is assigned");
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  const row = await repo.upsert({
    stationId, date, eventType, eventId, flightRef,
    releaserUserId: releaserUserId || null, releaserCategory: releaserUserId ? releaserCategory : null,
    supportUserId: supportUserId || null, actorId: actor.sub,
  });
  await auditTrail.logActivity(
    "Departure manpower manually assigned",
    `${date.toISOString().slice(0, 10)} ${flightRef}: releaser=${row.releaser?.fullName || "none"} (${row.releaserCategory || "-"}), support=${row.support?.fullName || "none"}`,
    stationId, actor, req,
  );
  return row;
}

module.exports = { getDayAllocation, autoAllocateDay, manualAssign };
