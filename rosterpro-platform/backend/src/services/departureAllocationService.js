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
const { allocateDepartureManpower } = require("../utils/departureAllocationEngine");

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

// Merges the day's real departures with whatever's already assigned in the
// database, in the shape the frontend renders directly.
async function getDayAllocation(stationId, year, month, day, actor) {
  assertOwnStation(actor, stationId);
  const date = new Date(Date.UTC(year, month - 1, day));
  const [departures, existingRows] = await Promise.all([
    buildDayDepartures(stationId, year, month, day),
    repo.listForDate(stationId, date),
  ]);
  const existingByKey = {};
  existingRows.forEach(r => { existingByKey[`${r.eventType}:${r.eventId}:${date.toISOString().slice(0, 10)}`] = r; });

  return departures.map(dep => {
    const existing = existingByKey[dep.key];
    return {
      key: dep.key, eventType: dep.eventType, eventId: dep.eventId, flightRef: dep.flightRef, route: dep.route,
      depTime: minutesToHHMM(dep.depMin),
      releaser: existing?.releaser ? { id: existing.releaser.id, fullName: existing.releaser.fullName, category: existing.releaserCategory } : null,
      support: existing?.support ? { id: existing.support.id, fullName: existing.support.fullName } : null,
    };
  });
}

// Eligible staff for a given date: active, not blocked (expired
// qualification/license), not on approved leave that day — the same three
// gates buildRosterAssignments already applies for whole-shift generation,
// applied here per-departure instead.
async function eligibleStaffPools(stationId, date) {
  const staff = await rosterRepo.getActiveStaffForGeneration(stationId);
  const [leaves, complianceSummaries] = await Promise.all([
    leaveRepo.approvedLeaveForStaffInRange(staff.map(s => s.id), date, date),
    Promise.all(staff.map(s => complianceService.getComplianceSummary(s.id))),
  ]);
  const onLeave = new Set(leaves.map(l => l.userId));
  const blocked = new Set(staff.filter((s, i) => complianceSummaries[i].isBlocked).map(s => s.id));
  const eligible = staff.filter(s => !onLeave.has(s.id) && !blocked.has(s.id));

  const pools = { B1: [], CM: [], NCS: [] };
  eligible.forEach(s => { if (pools[s.category]) pools[s.category].push(s.id); });
  return pools;
}

// Auto-allocates every still-unassigned departure on the day — a manual
// pick already on file is preserved untouched (never silently overwritten
// by re-running this), matching the requirement that the result can still
// be changed by hand afterward.
async function autoAllocateDay(stationId, year, month, day, actor, req) {
  assertOwnStation(actor, stationId);
  const date = new Date(Date.UTC(year, month - 1, day));
  const [departures, existingRows, config] = await Promise.all([
    buildDayDepartures(stationId, year, month, day),
    repo.listForDate(stationId, date),
    workloadConfigService.getWorkloadConfig(stationId),
  ]);
  if (departures.length === 0) return [];

  const staffPools = await eligibleStaffPools(stationId, date);
  const dateKey = date.toISOString().slice(0, 10);
  const existingByKey = {};
  existingRows.forEach(r => {
    if (!r.releaserUserId && !r.supportUserId) return;
    existingByKey[`${r.eventType}:${r.eventId}:${dateKey}`] = {
      releaserUserId: r.releaserUserId, releaserCategory: r.releaserCategory, supportUserId: r.supportUserId,
    };
  });

  const allocations = allocateDepartureManpower(departures, staffPools, config.clashProximityMinutes, existingByKey);
  const byKey = {};
  departures.forEach(d => { byKey[d.key] = d; });

  await repo.bulkUpsert(allocations.map(a => ({
    stationId, date, eventType: byKey[a.key].eventType, eventId: byKey[a.key].eventId, flightRef: byKey[a.key].flightRef,
    releaserUserId: a.releaserUserId, releaserCategory: a.releaserCategory, supportUserId: a.supportUserId, actorId: actor.sub,
  })));

  const unfilledCount = allocations.filter(a => a.unfilled).length;
  await auditTrail.logActivity(
    "Departure manpower auto-allocated",
    `${dateKey}: ${allocations.length} departure(s), ${unfilledCount} unfilled`,
    stationId, actor, req,
  );

  return getDayAllocation(stationId, year, month, day, actor);
}

// Manual override for exactly one departure — set releaserUserId/
// supportUserId to null to clear that slot.
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

// Purpose-built, minimal staff list for the releaser/support pickers on
// this page — id/name/category only, gated by the same roster:read this
// whole feature already requires. Deliberately NOT the full /api/users
// listing (that requires the stricter `users:read` permission most
// roster:update holders, e.g. LMM, don't have — this page must stay usable
// for exactly that role without widening a broader admin permission just
// to populate a picker).
async function listEligibleStaff(stationId, actor) {
  assertOwnStation(actor, stationId);
  const staff = await rosterRepo.getActiveStaffForGeneration(stationId);
  return staff
    .filter(s => s.category === "B1" || s.category === "CM" || s.category === "NCS")
    .map(s => ({ id: s.id, fullName: s.fullName, category: s.category }));
}

module.exports = { getDayAllocation, autoAllocateDay, manualAssign, listEligibleStaff };
