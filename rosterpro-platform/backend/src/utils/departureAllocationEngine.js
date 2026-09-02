// Pure, DB-free per-flight manpower allocator for the day-wise Departure
// Manpower Allocation feature. Distinct from rosterGenerationAlgorithm.js
// (which assigns staff to whole-shift M/A/N duty codes for the month) —
// this assigns specific staff to specific DEPARTURES on one day, drawn
// ONLY from whoever is actually on the real shift roster at that moment —
// never from the station's full active-staff list.
//
// Each departure gets a "releaser" (a B1 OR a CM — either one legitimately
// gives/releases a departure) plus one "support" (an NCS). This mirrors
// workloadEngine.js's computeDailyShiftDemand clash floor exactly: NCS
// count must be >= the number of departures clashing within
// clashProximityMinutes of each other, and (B1+CM combined) must be >=
// that same clash count — never forced to be all B1. A single person can
// legitimately be assigned to several departures that DON'T clash with
// each other (same as one B1 covering several spaced-out movements), but
// never to two that do.
const { classifyTimeToShift } = require("./workloadEngine");
const { excelCellToMinutes, minutesToHHMM } = require("./flightScheduleParser");

// Resolves which real shift-roster row a departure at `depMin` (minutes
// since midnight on its own calendar day) must be staffed from, and which
// CALENDAR DATE that roster row is filed under. A shift whose window
// crosses midnight (Night: e.g. 21:00-07:00) is filed on its START date —
// so a 04:00-06:00 departure is covered by the PREVIOUS day's Night crew
// (dayOffset -1, "still on duty till 07:00"), while a 22:00 departure on
// the same shift is covered by THAT day's own Night crew (dayOffset 0).
// A shift that doesn't cross midnight (Morning, Afternoon) always resolves
// to dayOffset 0. Returns null if depMin falls in no configured shift at
// all (a gap between shift windows, or shiftDefs missing entirely).
function resolveRosterShiftForDeparture(depMin, shiftDefs) {
  const shiftCode = classifyTimeToShift(minutesToHHMM(depMin), shiftDefs);
  if (!shiftCode) return null;
  const def = shiftDefs[shiftCode];
  const start = excelCellToMinutes(def.start), end = excelCellToMinutes(def.end);
  const crossesMidnight = start > end;
  const dayOffset = (crossesMidnight && depMin < start) ? -1 : 0;
  return { shiftCode, dayOffset };
}

// Tracks, per staff id, the list of [start,end] minute-windows they're
// already committed to for the day — a candidate is eligible for a new
// window only if it doesn't overlap any window already on their list.
function makeBusyTracker() {
  const windows = {};
  return {
    isBusy(userId, start, end) {
      return (windows[userId] || []).some(([s, e]) => start < e && end > s);
    },
    markBusy(userId, start, end) {
      (windows[userId] ??= []).push([start, end]);
    },
  };
}

// Round-robin picker over a fixed pool: scans forward from where the last
// successful pick left off (wrapping around), skipping anyone busy for the
// requested window — spreads assignments across the whole pool over the
// day instead of always handing every free slot to the first name in the
// list, while still skipping straight to the next eligible name when the
// front of the pool is currently clash-busy. On failure, returns a reason
// distinguishing "nobody at all is rostered on this shift" from "everyone
// in this shift's crew is already committed to another clashing departure"
// — the same blank dropdown looks identical in the UI otherwise, leaving a
// planner unable to tell a genuine staffing gap from "just add more people
// to this shift's roster" without redoing the clash math by hand.
function makeRotator(pool, busyTracker) {
  let cursor = 0;
  return function pickNext(start, end) {
    if (pool.length === 0) return { id: null, reason: "no_one_rostered" };
    for (let k = 0; k < pool.length; k++) {
      const idx = (cursor + k) % pool.length;
      const id = pool[idx];
      if (!busyTracker.isBusy(id, start, end)) {
        cursor = idx + 1;
        return { id, reason: null };
      }
    }
    return { id: null, reason: "all_busy_with_clash" };
  };
}

// departures: [{ key, depMin, poolKey, releaserB1: [userId,...],
// releaserCM: [...], supportNCS: [...] }] — the caller has ALREADY
// resolved each departure to its correct roster-shift+date (via
// resolveRosterShiftForDeparture) and looked up exactly who's on that
// shift; this function has no DB access and makes no eligibility judgment
// beyond the clash-window check. `poolKey` identifies which underlying
// roster-shift a departure draws from (e.g. "N:2026-09-02") — departures
// sharing a poolKey share ONE round-robin rotator (fair rotation across
// that crew), while departures resolving to a different shift/date get
// their own independent rotator, since they draw from a different crew
// entirely.
// existingAssignments: { [key]: { releaserUserId, releaserCategory,
// supportUserId } } — a manual pick already on file for that departure is
// kept as-is (and still marked busy, so it correctly blocks a clashing
// departure from being auto-assigned to the same person) rather than
// being overwritten.
function allocateDepartureManpower(departures, clashProximityMinutes, existingAssignments = {}) {
  const half = (clashProximityMinutes || 60) / 2;
  const ordered = departures
    .map((d, i) => ({ ...d, _i: i }))
    .sort((a, b) => (a.depMin - b.depMin) || (a._i - b._i));

  const busy = makeBusyTracker();
  const releaserRotators = {};
  const supportRotators = {};

  return ordered.map(dep => {
    const start = dep.depMin - half, end = dep.depMin + half;
    const existing = existingAssignments[dep.key];

    const releaserPool = [...(dep.releaserB1 || []), ...(dep.releaserCM || [])];
    const releaserCategoryById = {};
    (dep.releaserB1 || []).forEach(id => { releaserCategoryById[id] = "B1"; });
    (dep.releaserCM || []).forEach(id => { releaserCategoryById[id] = "CM"; });
    const supportPool = dep.supportNCS || [];

    let releaserUserId = existing?.releaserUserId || null;
    let releaserCategory = existing?.releaserCategory || (releaserUserId ? releaserCategoryById[releaserUserId] : null);
    let releaserUnfilledReason = null;
    if (!releaserUserId) {
      releaserRotators[dep.poolKey] ??= makeRotator(releaserPool, busy);
      const picked = releaserRotators[dep.poolKey](start, end);
      releaserUserId = picked.id;
      releaserCategory = releaserUserId ? releaserCategoryById[releaserUserId] : null;
      releaserUnfilledReason = picked.reason;
    }
    if (releaserUserId) busy.markBusy(releaserUserId, start, end);

    let supportUserId = existing?.supportUserId || null;
    let supportUnfilledReason = null;
    if (!supportUserId) {
      supportRotators[dep.poolKey] ??= makeRotator(supportPool, busy);
      const picked = supportRotators[dep.poolKey](start, end);
      supportUserId = picked.id;
      supportUnfilledReason = picked.reason;
    }
    if (supportUserId) busy.markBusy(supportUserId, start, end);

    return {
      key: dep.key, depMin: dep.depMin, releaserUserId, releaserCategory, supportUserId,
      unfilled: !releaserUserId || !supportUserId,
      releaserUnfilledReason, supportUnfilledReason,
    };
  });
}

module.exports = { resolveRosterShiftForDeparture, allocateDepartureManpower };
