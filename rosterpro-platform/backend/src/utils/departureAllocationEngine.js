// Pure, DB-free per-flight manpower allocator for the day-wise Departure
// Manpower Allocation feature. Distinct from rosterGenerationAlgorithm.js
// (which assigns staff to whole-shift M/A/N duty codes for the month) —
// this assigns specific staff to specific DEPARTURES on one day.
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
// front of the pool is currently clash-busy.
function makeRotator(pool, busyTracker) {
  let cursor = 0;
  return function pickNext(start, end) {
    for (let k = 0; k < pool.length; k++) {
      const idx = (cursor + k) % pool.length;
      const id = pool[idx];
      if (!busyTracker.isBusy(id, start, end)) {
        cursor = idx + 1;
        return id;
      }
    }
    return null;
  };
}

// departures: [{ key, depMin }] — key is the stable identifier the caller
// uses to persist this departure's assignment (e.g. "turn:<id>:<date>").
// staffPools: { B1: [userId,...], CM: [...], NCS: [...] } — active,
// non-blocked, non-on-leave staff at the station for this date, already
// filtered by the caller (this function has no DB access and makes no
// eligibility judgment beyond the clash-window check).
// existingAssignments: { [key]: { releaserUserId, releaserCategory,
// supportUserId } } — a manual pick already on file for that departure is
// kept as-is (and still marked busy, so it correctly blocks a clashing
// departure from being auto-assigned to the same person) rather than
// being overwritten.
function allocateDepartureManpower(departures, staffPools, clashProximityMinutes, existingAssignments = {}) {
  const half = (clashProximityMinutes || 60) / 2;
  const ordered = departures
    .map((d, i) => ({ ...d, _i: i }))
    .sort((a, b) => (a.depMin - b.depMin) || (a._i - b._i));

  const busy = makeBusyTracker();
  const releaserPool = [...(staffPools.B1 || []), ...(staffPools.CM || [])];
  const releaserCategoryById = {};
  (staffPools.B1 || []).forEach(id => { releaserCategoryById[id] = "B1"; });
  (staffPools.CM || []).forEach(id => { releaserCategoryById[id] = "CM"; });
  const supportPool = [...(staffPools.NCS || [])];

  const pickReleaser = makeRotator(releaserPool, busy);
  const pickSupport = makeRotator(supportPool, busy);

  return ordered.map(dep => {
    const start = dep.depMin - half, end = dep.depMin + half;
    const existing = existingAssignments[dep.key];

    let releaserUserId = existing?.releaserUserId || null;
    let releaserCategory = existing?.releaserCategory || (releaserUserId ? releaserCategoryById[releaserUserId] : null);
    if (!releaserUserId) {
      releaserUserId = pickReleaser(start, end);
      releaserCategory = releaserUserId ? releaserCategoryById[releaserUserId] : null;
    }
    if (releaserUserId) busy.markBusy(releaserUserId, start, end);

    let supportUserId = existing?.supportUserId || null;
    if (!supportUserId) supportUserId = pickSupport(start, end);
    if (supportUserId) busy.markBusy(supportUserId, start, end);

    return {
      key: dep.key, depMin: dep.depMin, releaserUserId, releaserCategory, supportUserId,
      unfilled: !releaserUserId || !supportUserId,
    };
  });
}

module.exports = { allocateDepartureManpower };
