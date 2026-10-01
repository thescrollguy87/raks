// Ported verbatim from the RosterPro PWA (RosterProPWA9.zip)'s workload
// engine (transit/PDC classification, clash detection, task-master demand,
// rule scoring). This is the exact area the user flagged as having had
// real bugs fixed before: transit/PDC double-counting, monthly totals
// divided by the wrong denominator, raw movement counts instead of peak
// concurrency. Every comment explaining WHY a line is written the way it
// is has been kept, not summarized away.
const { expandOperatingDates, localDateKey } = require("./flightScheduleParser");

// Generic sweep-line concurrency detector — used identically for transit
// overlap and PDC overlap, since both are "find where time windows stack
// up" problems.
function findPeakConcurrency(events) {
  if (!events.length) return { peak: 0, peakTime: null, activeAtPeak: [] };
  const points = [];
  events.forEach((e, i) => { points.push([e.start, 1, i]); points.push([e.end, -1, i]); });
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // ends processed before starts at an identical instant — touching windows don't count as overlapping
  let count = 0, peak = 0, peakTime = null;
  for (const [t, delta] of points) {
    count += delta;
    if (count > peak) { peak = count; peakTime = t; }
  }
  const activeAtPeak = events.filter(e => e.start <= peakTime && e.end > peakTime);
  return { peak, peakTime, activeAtPeak };
}

// Absolute minutes (not minutes-of-day) so events on different calendar
// days never falsely appear to overlap — this matters specifically for
// overnight turns.
function dateAndMinutesToAbsMin(dateObj, minutesOfDay) {
  return Math.floor(dateObj.getTime() / 60000) + minutesOfDay;
}

// Resolves the actual ground time for a turn, in minutes — uses the real
// imported value when present, otherwise derives it from arrival/departure
// times directly (handling the overnight-crossing case).
function getEffectiveGroundTime(rec) {
  if (rec.groundTimeMin !== null && rec.groundTimeMin !== undefined) return rec.groundTimeMin;
  if (rec.inboundArrMin === null || rec.outboundDepMin === null) return null;
  let g = rec.outboundDepMin - rec.inboundArrMin;
  if (g < 0) g += 1440;
  return g;
}

// Transit and PDC are mutually exclusive classifications of the SAME turn,
// not two separate workload sources that both apply to every departure: a
// quick turnaround (ground time <= threshold) is a Transit; anything
// longer requires a full Pre-Departure Check instead. An earlier version
// counted every turn as BOTH regardless of ground time, double-counting
// workload for every single departure.
function buildTransitWorkloadEvents(turnRecords, year, month, homeStation, config) {
  const events = [];
  const threshold = config.transitVsPdcThresholdMinutes;
  turnRecords.forEach(rec => {
    if (homeStation && rec.outboundDepSta !== homeStation && rec.inboundArrSta !== homeStation) return;
    const groundTime = getEffectiveGroundTime(rec);
    if (groundTime === null || groundTime > threshold) return; // longer stop — classified as a PDC instead
    const dates = expandOperatingDates(rec.effectiveDate, rec.discontinueDate, rec.daysOfWeek, year, month);
    dates.forEach(date => {
      const arrMin = rec.inboundArrMin;
      let depMin = rec.outboundDepMin;
      if (arrMin === null) return;
      if (depMin === null) {
        depMin = (arrMin + config.transitMinutesDefault) % 1440; // missing outbound data — fall back to the configured standard transit duration
      }
      let start = dateAndMinutesToAbsMin(date, arrMin);
      let end = dateAndMinutesToAbsMin(date, depMin);
      if (end <= start) end += 1440; // overnight ground time crossing midnight
      events.push({ start, end, date, label: `${rec.inboundFlt}→${rec.outboundFlt}` });
    });
  });
  return events;
}

// Pre-Departure Check workload — one window per departure, ending exactly
// at scheduled departure time and starting pdcMinutesBeforeDeparture earlier.
function buildPDCWorkloadEvents(turnRecords, charterRecords, year, month, homeStation, config) {
  const events = [];
  const pdcMin = config.pdcMinutesBeforeDeparture;
  const threshold = config.transitVsPdcThresholdMinutes;
  turnRecords.forEach(rec => {
    if (homeStation && rec.outboundDepSta !== homeStation) return;
    if (rec.outboundDepMin === null) return;
    const groundTime = getEffectiveGroundTime(rec);
    if (groundTime !== null && groundTime <= threshold) return; // quick turn — classified as Transit instead
    const dates = expandOperatingDates(rec.effectiveDate, rec.discontinueDate, rec.daysOfWeek, year, month);
    dates.forEach(date => {
      // `date` is the inbound arrival's operating date — for a long-ground-
      // time turn (that's what makes it a PDC rather than a Transit) the
      // outbound departure can genuinely fall on the CALENDAR DAY AFTER
      // that (aircraft arrives late evening, PDC work runs into/past
      // midnight for a next-morning departure). Transit events already
      // detect this same wrap by comparing arrival vs. departure
      // minutes-of-day; PDC previously never did, so an overnight PDC's
      // date/absolute time stayed anchored to the arrival day, misfiling
      // it a day early in both the peak-concurrency bucketing and the
      // per-day shift-window clipping.
      let depDate = date;
      if (rec.inboundArrMin !== null && rec.inboundArrMin !== undefined && rec.outboundDepMin <= rec.inboundArrMin) {
        depDate = new Date(date.getTime() + 86400000);
      }
      const end = dateAndMinutesToAbsMin(depDate, rec.outboundDepMin);
      events.push({ start: end - pdcMin, end, date: depDate, label: `Flt ${rec.outboundFlt}` });
    });
  });
  charterRecords.forEach(rec => {
    if (homeStation && rec.depSta !== homeStation) return;
    if (rec.depMin === null) return;
    const dates = expandOperatingDates(rec.effectiveDate, rec.discontinueDate, rec.daysOfWeek, year, month);
    dates.forEach(date => {
      const end = dateAndMinutesToAbsMin(date, rec.depMin);
      events.push({ start: end - pdcMin, end, date, label: `Charter ${rec.flightDesg}` });
    });
  });
  return events;
}

// Clash detection uses its OWN independently-configurable proximity
// threshold, not the PDC duration — each departure gets a SYMMETRIC window
// of [depTime - threshold/2, depTime + threshold/2]; two such windows
// overlap exactly when the two departure times are less than `threshold`
// apart.
function buildClashEvents(turnRecords, charterRecords, year, month, homeStation, config) {
  const events = [];
  const half = config.clashProximityMinutes / 2;
  turnRecords.forEach(rec => {
    if (homeStation && rec.outboundDepSta !== homeStation) return;
    if (rec.outboundDepMin === null) return;
    const dates = expandOperatingDates(rec.effectiveDate, rec.discontinueDate, rec.daysOfWeek, year, month);
    dates.forEach(date => {
      const dep = dateAndMinutesToAbsMin(date, rec.outboundDepMin);
      events.push({ start: dep - half, end: dep + half, date, depTime: rec.outboundDepMin, label: `Flt ${rec.outboundFlt}` });
    });
  });
  charterRecords.forEach(rec => {
    if (homeStation && rec.depSta !== homeStation) return;
    if (rec.depMin === null) return;
    const dates = expandOperatingDates(rec.effectiveDate, rec.discontinueDate, rec.daysOfWeek, year, month);
    dates.forEach(date => {
      const dep = dateAndMinutesToAbsMin(date, rec.depMin);
      events.push({ start: dep - half, end: dep + half, date, depTime: rec.depMin, label: `Charter ${rec.flightDesg}` });
    });
  });
  return events;
}

// Groups a flat list of time-windowed events by calendar day and finds the
// peak concurrency WITHIN each day. Uses localDateKey, NOT .toISOString(),
// since e.date is built (via expandOperatingDates) using the LOCAL Date
// constructor — reading it back with .toISOString() (always UTC) would
// silently shift the label a day earlier whenever the server's timezone
// sits east of UTC (IST included), misfiling the event into the wrong
// day's peak-concurrency bucket.
function computeDailyPeaks(events) {
  const byDate = {};
  events.forEach(e => {
    const key = localDateKey(e.date);
    (byDate[key] = byDate[key] || []).push(e);
  });
  const perDay = Object.entries(byDate).map(([date, dayEvents]) => {
    const { peak, peakTime, activeAtPeak } = findPeakConcurrency(dayEvents);
    return { date, occurrences: dayEvents.length, peak, peakTime, activeAtPeak };
  });
  let monthPeak = 0, monthPeakDay = null;
  perDay.forEach(d => { if (d.peak > monthPeak) { monthPeak = d.peak; monthPeakDay = d; } });
  const totalOccurrences = events.length;
  const avgPerDay = perDay.length ? Math.round((totalOccurrences / perDay.length) * 10) / 10 : 0;
  return { perDay, totalOccurrences, avgPerDay, monthPeak, monthPeakDay };
}

// Automatic clash detection, reported per-day. Manual additions are ALWAYS
// shown separately and never merged into this automatic count.
function computeAutomaticClashes(clashEvents) {
  const stats = computeDailyPeaks(clashEvents);
  const clashDays = stats.perDay.filter(d => d.peak >= 2).map(d => {
    const { minutesToHHMM } = require("./flightScheduleParser");
    return {
      date: d.date,
      timeWindowStart: minutesToHHMM(((d.peakTime % 1440) + 1440) % 1440),
      flights: d.activeAtPeak.map(e => e.label),
      simultaneousCount: d.peak,
    };
  });
  return {
    clashDays,
    peakSimultaneous: stats.monthPeak,
    peakDate: stats.monthPeakDay?.date || null,
    peakFlights: stats.monthPeakDay?.activeAtPeak.map(e => e.label) || [],
  };
}

// Classifies a "HH:MM" time string into which shift (M/A/N) it falls
// within, based on the actual configured Shift Definition windows.
function classifyTimeToShift(timeStr, shiftDefs) {
  const { excelCellToMinutes } = require("./flightScheduleParser");
  if (!timeStr) return null;
  const min = excelCellToMinutes(timeStr);
  if (min === null) return null;
  for (const sh of ["M", "A", "N"]) {
    const def = shiftDefs[sh];
    if (!def || !def.start || !def.end) continue;
    const s = excelCellToMinutes(def.start), e = excelCellToMinutes(def.end);
    if (s <= e) { if (min >= s && min < e) return sh; }
    else { if (min >= s || min < e) return sh; } // shift window itself crosses midnight
  }
  return null;
}

// Aggregates every Manual Demand entry for a target month into per-day,
// per-shift, per-category totals — entries with no time given default to
// Morning rather than being silently dropped.
function getManualDemandByDayShift(manualDemandEntries, year, month, shiftDefs) {
  const result = {};
  manualDemandEntries.forEach(m => {
    const d = m.date instanceof Date ? m.date : new Date(m.date);
    if (isNaN(d) || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1) return;
    const day = d.getUTCDate();
    const sh = classifyTimeToShift(m.timeStart, shiftDefs) || "M";
    result[day] = result[day] || { M: { B1: 0, B2: 0, CM: 0, NCS: 0 }, A: { B1: 0, B2: 0, CM: 0, NCS: 0 }, N: { B1: 0, B2: 0, CM: 0, NCS: 0 } };
    result[day][sh].B1 += (+m.reqB1 || 0);
    result[day][sh].B2 += (+m.reqB2 || 0);
    result[day][sh].CM += (+m.reqCM || 0);
    result[day][sh].NCS += (+m.reqNCS || 0);
  });
  return result;
}

// THE function that actually connects the workload engine to the
// generator: a REAL per-day, per-shift B1/CM/NCS requirement by counting
// how many transit+PDC events actually fall within each shift's time
// window on each specific day (peak concurrency, not a flat ÷3 monthly
// average), converted to headcount via the configurable movements-per-
// staff ratios. Falls back cleanly to flat base coverage when no flight
// schedule exists for the target month.
function computeDailyShiftDemand({ year, month, homeStation, baseCoverage, ncsBaseCoverage, cmBaseCoverage, flightSchedule, config, manualDemandEntries, shiftDefs, perShiftBuffer, taskMasterByShiftCategory }) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const demand = {};
  const manualByDayShift = getManualDemandByDayShift(manualDemandEntries || [], year, month, shiftDefs);
  const buf = perShiftBuffer || { B1: 0, B2: 0, CM: 0, NCS: 0 };
  const ncsFloorBy = ncsBaseCoverage || { M: 0, A: 0, N: 0 };
  const cmFloorBy = cmBaseCoverage || { M: 0, A: 0, N: 0 };
  // Planned Maintenance Tasks (Task Master) + Unplanned Workload, already
  // pre-averaged into a per-day, per-shift, per-category headcount by the
  // caller. Real operational feedback: the Mandatory Minimum floor is meant
  // to already represent "enough for a typical shift including our normal
  // recurring workload," not a number set in ignorance of it — so Task
  // Master demand takes the MAX with the floor (like flight concurrency
  // already does for NCS), never gets summed on top of it. Manual Demand
  // and the per-shift buffer stay purely additive on top of that max, since
  // those represent genuinely separate, situational extras (a specific
  // date's planner override, a standing ad-hoc safety margin) rather than
  // another estimate of the same baseline workload.
  const tmBy = taskMasterByShiftCategory || { M: {}, A: {}, N: {} };

  for (let d = 1; d <= daysInMonth; d++) {
    const manual = manualByDayShift[d];
    demand[d] = {};
    ["M", "A", "N"].forEach(sh => {
      demand[d][sh] = {
        B1: Math.max(baseCoverage[sh] || 0, tmBy[sh]?.B1 || 0) + (manual?.[sh].B1 || 0) + (buf.B1 || 0),
        CM: Math.max(cmFloorBy[sh] || 0, tmBy[sh]?.CM || 0) + (manual?.[sh].CM || 0) + (buf.CM || 0),
        NCS: Math.max(ncsFloorBy[sh] || 0, tmBy[sh]?.NCS || 0) + (manual?.[sh].NCS || 0) + (buf.NCS || 0),
      };
    });
  }

  // Traces WHICH day and WHICH real flights drive the worst-case number for
  // each category/shift — the single biggest source of "these numbers don't
  // match what I see in the flight schedule" confusion, since Category
  // Requirement shows a peak-of-month figure but nothing on screen ever
  // said which day that peak actually fell on or what was overlapping.
  // Keyed by category then shift; each entry is the (day, breakdown) pair
  // with the highest TOTAL for that category/shift across the whole month.
  const emptyExplain = () => ({ M: null, A: null, N: null });
  const explain = { B1: emptyExplain(), CM: emptyExplain(), NCS: emptyExplain() };
  const recordExplain = (cat, sh, day, total, breakdown) => {
    const cur = explain[cat][sh];
    if (!cur || total > cur.total) explain[cat][sh] = { day, total, ...breakdown };
  };

  if (!flightSchedule) {
    return { demand, source: "base-coverage-only", reason: "No flight schedule imported for this exact month — using flat base coverage plus any Manual Demand, per-shift buffer, and Planned/Unplanned Task Master workload.", explain };
  }

  const { turnRecords, charterRecords } = flightSchedule;
  const transitEvents = buildTransitWorkloadEvents(turnRecords, year, month, homeStation, config);
  const pdcEvents = buildPDCWorkloadEvents(turnRecords, charterRecords, year, month, homeStation, config);
  const allEvents = [...transitEvents, ...pdcEvents];
  const ratioB1 = Math.max(1, config.movementsPerB1Staff || 4);
  const ratioCM = Math.max(1, config.movementsPerCMStaff || 1);
  const ratioNCS = Math.max(1, config.movementsPerNCSStaff || 1);

  // Automatic Departure Clashes: departures within clashProximityMinutes of
  // each other (default 60) each need their own dedicated release pair —
  // ONE (B1 or CM, either one qualifies to give the departure) PLUS one NCS
  // per clashing departure — see the general B1/CM pooling just below,
  // which this narrower clash-window constraint tops up on top of.
  const clashEvents = buildClashEvents(turnRecords, charterRecords, year, month, homeStation, config);
  let clashDrivenShiftCount = 0;

  // B1 and CM are interchangeable release/certifying capacity, not two
  // independent demand streams each needing to cover the full overlap
  // alone — a station's real practice is "1 B1 takes this aircraft, the
  // overlapping one goes to whichever CM is free," not "we need a second
  // B1 AND a second CM." So B1 is held at its own Mandatory Minimum
  // Coverage floor (never inflated by concurrency — that's what "prefer
  // B1 first" means: the floor is the baseline that's always there, and
  // any load beyond what it can cover is what actually needs an extra
  // head), and CM absorbs whatever peak concurrency the B1 floor's own
  // ratio-based capacity doesn't already cover. Task Master workload is a
  // separate axis from concurrency — it takes the MAX with the Mandatory
  // Minimum floor rather than adding to it, since the floor is meant to
  // already represent "enough for a typical shift including our normal
  // recurring workload," not a number set in ignorance of it (real
  // feedback: summing them double-counted the same baseline workload
  // twice). The narrower automatic-clash constraint (B1+CM combined >=
  // clashPeak) still applies on top, in case a tight departure clash
  // demands more combined heads than the
  // general concurrency pooling alone would.
  function buildB1Label(floor, peakConcurrency, coveredByFloor, remainder, taskMaster, core) {
    const floorPart = floor > 0
      ? (remainder > 0
        ? `mandatory floor ${floor} (covers ${coveredByFloor} of ${peakConcurrency} concurrent aircraft; CM covers the remaining ${remainder})`
        : `mandatory floor ${floor} (fully covers ${peakConcurrency} concurrent aircraft)`)
      : (remainder > 0
        ? `no mandatory floor set for this shift — CM covers all ${peakConcurrency} concurrent aircraft`
        : `no mandatory floor set for this shift, no concurrent aircraft`);
    // Task Master demand takes the MAX with the floor (never summed on top
    // of it) — the floor is meant to already represent "enough for typical
    // recurring workload," so this is "whichever asks for more," not two
    // separate requirements stacked.
    return taskMaster > floor ? `max(${floorPart}, task master ${taskMaster})=${core}` : `${floorPart}=${core}`;
  }
  function buildCmLabel(peakConcurrency, coveredByB1, remainder, ratioCM, cmFromConcurrency, clashTopUp, mandatoryFloor, taskMaster, core) {
    let base = remainder > 0 || coveredByB1 > 0
      ? `concurrency remaining after B1's ${coveredByB1}-capacity ceil((${peakConcurrency}-${coveredByB1})÷${ratioCM})=${cmFromConcurrency}`
      : `concurrency ceil(${peakConcurrency}÷${ratioCM})=${cmFromConcurrency}`;
    let wrapped = false;
    if (clashTopUp > 0) { base = `${base} + clash top-up +${clashTopUp}`; wrapped = true; }
    const maxTerms = [];
    if (mandatoryFloor > 0) maxTerms.push(`mandatory floor ${mandatoryFloor}`);
    maxTerms.push(base);
    if (taskMaster > 0) maxTerms.push(`task master ${taskMaster}`);
    if (maxTerms.length > 1) { base = `max(${maxTerms.join(", ")})`; wrapped = true; }
    return wrapped ? `${base}=${core}` : base;
  }

  // NCS is a separate support role, not pooled with B1/CM. Task Master
  // demand joins the same max() as the mandatory floor and clash floor —
  // the floor is meant to already represent "enough for typical recurring
  // workload," so this is "whichever asks for more," never a sum of both.
  function buildCoreLabel(mandatoryFloor, peakConcurrency, ratio, concurrencyDriven, clashTopUp, clashPeak, taskMaster, core) {
    let base = `concurrency ceil(${peakConcurrency}÷${ratio})=${concurrencyDriven}`;
    if (clashTopUp > 0) base = `${base} + clash top-up +${clashTopUp}`;
    const maxTerms = [];
    if (mandatoryFloor > 0) maxTerms.push(`mandatory floor ${mandatoryFloor}`);
    maxTerms.push(base);
    if (taskMaster > 0) maxTerms.push(`task master ${taskMaster}`);
    if (clashPeak > 0) maxTerms.push(`clash floor ${clashPeak}`);
    if (maxTerms.length > 1) return `max(${maxTerms.join(", ")})=${core}`;
    return base;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const manual = manualByDayShift[d];
    ["M", "A", "N"].forEach(sh => {
      const def = shiftDefs[sh];
      if (!def || !def.start || !def.end) return;
      const { excelCellToMinutes } = require("./flightScheduleParser");
      const startAbs = dateAndMinutesToAbsMin(date, excelCellToMinutes(def.start));
      let endAbs = dateAndMinutesToAbsMin(date, excelCellToMinutes(def.end));
      if (endAbs <= startAbs) endAbs += 1440; // shift itself crosses midnight
      // Clip each overlapping event to the shift's own window, then find
      // PEAK CONCURRENCY within it — NOT a raw count of every movement
      // that merely touches the shift.
      const clipped = allEvents
        .filter(e => e.start < endAbs && e.end > startAbs)
        .map(e => ({ start: Math.max(e.start, startAbs), end: Math.min(e.end, endAbs), label: e.label }));
      const peakInfo = findPeakConcurrency(clipped);
      const peakConcurrency = peakInfo.peak;
      const flights = peakInfo.activeAtPeak.map(e => e.label);
      const clippedClash = clashEvents
        .filter(e => e.start < endAbs && e.end > startAbs)
        .map(e => ({ start: Math.max(e.start, startAbs), end: Math.min(e.end, endAbs) }));
      const clashPeak = findPeakConcurrency(clippedClash).peak;
      if (clashPeak > 0) clashDrivenShiftCount++;

      const b1Floor = baseCoverage[sh] || 0;
      const cmFloor = cmFloorBy[sh] || 0;
      const tmB1 = tmBy[sh]?.B1 || 0, tmCM = tmBy[sh]?.CM || 0, tmNCS = tmBy[sh]?.NCS || 0;

      // The Mandatory Minimum floor is meant to already represent "enough
      // for a typical shift including our normal recurring workload," not a
      // number set in ignorance of Task Master's own hours — so Task Master
      // demand takes the MAX with the floor, never gets summed on top of
      // it, exactly like flight concurrency already does for NCS/CM below.
      // B1's real guaranteed headcount (b1Base) folds in BEFORE computing
      // its pooling capacity, so if Task Master pushes B1 above its floor,
      // that extra B1 headcount also helps absorb concurrency — reducing
      // what CM needs to cover, same as any other B1 presence would.
      const b1Base = Math.max(b1Floor, tmB1);
      const b1PoolCapacity = b1Base * ratioB1;
      const remainingAfterB1 = Math.max(0, peakConcurrency - b1PoolCapacity);
      const cmFromConcurrency = Math.ceil(remainingAfterB1 / ratioCM);
      const cmClashTopUp = Math.max(0, clashPeak - (b1Base + cmFromConcurrency));
      const cmBase = Math.max(cmFloor, cmFromConcurrency + cmClashTopUp, tmCM);
      const ncsFloor = ncsFloorBy[sh] || 0;
      const ncsConcurrencyDriven = Math.ceil(peakConcurrency / ratioNCS);
      const ncsBase = Math.max(ncsFloor, ncsConcurrencyDriven, clashPeak, tmNCS);

      const b1Total = b1Base + (manual?.[sh].B1 || 0) + (buf.B1 || 0);
      const cmTotal = cmBase + (manual?.[sh].CM || 0) + (buf.CM || 0);
      const ncsTotal = ncsBase + (manual?.[sh].NCS || 0) + (buf.NCS || 0);

      demand[d][sh].B1 = b1Total;
      demand[d][sh].CM = cmTotal;
      demand[d][sh].NCS = ncsTotal;

      recordExplain("B1", sh, d, b1Total, {
        core: b1Base, coreLabel: buildB1Label(b1Floor, peakConcurrency, Math.min(b1PoolCapacity, peakConcurrency), remainingAfterB1, tmB1, b1Base),
        manual: manual?.[sh].B1 || 0, buffer: buf.B1 || 0, flights,
      });
      recordExplain("CM", sh, d, cmTotal, {
        core: cmBase, coreLabel: buildCmLabel(peakConcurrency, Math.min(b1PoolCapacity, peakConcurrency), remainingAfterB1, ratioCM, cmFromConcurrency, cmClashTopUp, cmFloor, tmCM, cmBase),
        manual: manual?.[sh].CM || 0, buffer: buf.CM || 0, flights,
      });
      recordExplain("NCS", sh, d, ncsTotal, {
        core: ncsBase, coreLabel: buildCoreLabel(ncsFloor, peakConcurrency, ratioNCS, ncsConcurrencyDriven, 0, clashPeak, tmNCS, ncsBase),
        manual: manual?.[sh].NCS || 0, buffer: buf.NCS || 0, flights,
      });
    });
  }
  return {
    demand, source: "flight-schedule-driven",
    reason: `Derived from ${allEvents.length} real transit/PDC events, using PEAK CONCURRENCY per shift. B1 is the max of its Mandatory Minimum floor and its own Task Master workload; CM pools with B1's real headcount to cover the rest (1-per-${ratioCM}), then takes the max of that, its own Mandatory Minimum floor, and its own Task Master workload; NCS takes the max of its own Mandatory Minimum floor, 1-per-${ratioNCS} concurrency, and its own Task Master workload. Task Master demand is never summed on top of a Mandatory Minimum floor — the floor is meant to already cover typical recurring workload, so whichever is larger wins. ${clashDrivenShiftCount} shift(s) had a departure clash (within ${config.clashProximityMinutes}min) that required NCS >= the clash count and (B1+CM combined) >= the clash count.`,
    explain,
  };
}

// Converts a task master's configured frequency into expected manpower-
// hours for the target month — NEVER invents a manpower number; every
// requirement figure comes directly from what the planner configured.
// byShiftCategory routes each task's hours to its actual preferredShift,
// not split evenly across all three, unless no preferred shift is set.
function computeTaskMasterDemand(taskMaster, daysInMonth, operatingDays) {
  let totalHours = 0;
  const byCategory = { B1: 0, B2: 0, CM: 0, NCS: 0 };
  const byShift = { M: 0, A: 0, N: 0 };
  const byShiftCategory = { M: { B1: 0, B2: 0, CM: 0, NCS: 0 }, A: { B1: 0, B2: 0, CM: 0, NCS: 0 }, N: { B1: 0, B2: 0, CM: 0, NCS: 0 } };
  const taskBreakdown = [];
  taskMaster.forEach(t => {
    let occurrences = 0;
    if (t.frequencyUnit === "per_month") occurrences = t.frequency;
    else if (t.frequencyUnit === "per_week") occurrences = t.frequency * (daysInMonth / 7);
    else if (t.frequencyUnit === "per_operating_day") occurrences = t.frequency * operatingDays;
    const hoursPerOccurrence = (t.avgDurationMin || 0) / 60;
    const manHoursPerOccurrence = hoursPerOccurrence * ((t.reqB1 || 0) + (t.reqB2 || 0) + (t.reqCM || 0) + (t.reqNCS || 0));
    const taskTotalHours = occurrences * manHoursPerOccurrence;
    totalHours += taskTotalHours;
    byCategory.B1 += occurrences * hoursPerOccurrence * (t.reqB1 || 0);
    byCategory.B2 += occurrences * hoursPerOccurrence * (t.reqB2 || 0);
    byCategory.CM += occurrences * hoursPerOccurrence * (t.reqCM || 0);
    byCategory.NCS += occurrences * hoursPerOccurrence * (t.reqNCS || 0);
    const shifts = (t.preferredShift === "M" || t.preferredShift === "A" || t.preferredShift === "N") ? [t.preferredShift] : ["M", "A", "N"];
    const shiftSplit = 1 / shifts.length;
    shifts.forEach(sh => {
      byShift[sh] += taskTotalHours * shiftSplit;
      byShiftCategory[sh].B1 += occurrences * hoursPerOccurrence * (t.reqB1 || 0) * shiftSplit;
      byShiftCategory[sh].B2 += occurrences * hoursPerOccurrence * (t.reqB2 || 0) * shiftSplit;
      byShiftCategory[sh].CM += occurrences * hoursPerOccurrence * (t.reqCM || 0) * shiftSplit;
      byShiftCategory[sh].NCS += occurrences * hoursPerOccurrence * (t.reqNCS || 0) * shiftSplit;
    });
    if (occurrences > 0) {
      taskBreakdown.push({
        name: t.name, occurrences: Math.round(occurrences * 10) / 10, totalHours: Math.round(taskTotalHours * 10) / 10,
        preferredShift: t.preferredShift || "Any",
        byCategory: {
          B1: Math.round(occurrences * hoursPerOccurrence * (t.reqB1 || 0) * 10) / 10,
          B2: Math.round(occurrences * hoursPerOccurrence * (t.reqB2 || 0) * 10) / 10,
          CM: Math.round(occurrences * hoursPerOccurrence * (t.reqCM || 0) * 10) / 10,
          NCS: Math.round(occurrences * hoursPerOccurrence * (t.reqNCS || 0) * 10) / 10,
        },
      });
    }
  });
  return { totalHours: Math.round(totalHours * 10) / 10, byCategory, byShift, byShiftCategory, taskBreakdown };
}

// Unplanned workload supports frequency-based, manpower-hour-based, or
// both (summed), plus a configurable buffer % applied on top of the
// PLANNED workload total. plannedByCategory is the planned demand's own
// {B1,B2,CM,NCS} hours breakdown (computeTaskMasterDemand's byCategory) —
// needed so the buffer %, which scales with EACH category's own planned
// load, can be distributed per category rather than only ever shown as
// one opaque combined number.
function computeUnplannedWorkload(unplannedTaskMaster, config, plannedByCategory) {
  let hours = 0;
  const byCategory = { B1: 0, B2: 0, CM: 0, NCS: 0 };
  // Same per-shift routing as computeTaskMasterDemand: an unplanned task's
  // own Preferred Shift (Wheel Change/Troubleshooting/Brake Change are
  // typically Night; AOG Rectification etc. "Any") decides which shift its
  // hours land on, rather than every unplanned task's hours getting spread
  // evenly across all three shifts regardless of when the work actually
  // happens.
  const byShiftCategory = { M: { B1: 0, B2: 0, CM: 0, NCS: 0 }, A: { B1: 0, B2: 0, CM: 0, NCS: 0 }, N: { B1: 0, B2: 0, CM: 0, NCS: 0 } };
  // Per-task hours, same purpose as computeTaskMasterDemand's own
  // taskBreakdown: lets the Workload Summary/Explainable Manpower panels
  // show WHICH specific task is actually driving a category's total,
  // instead of only ever showing an opaque combined number a planner has
  // no way to trace back to one row in the Task Master table.
  const taskBreakdown = [];
  if (config.unplannedMethod === "frequency" || config.unplannedMethod === "both") {
    unplannedTaskMaster.forEach(t => {
      const hoursPerOcc = (t.avgDurationMin || 0) / 60;
      const manHours = t.avgFreqPerMonth * hoursPerOcc * ((t.reqB1 || 0) + (t.reqB2 || 0) + (t.reqCM || 0) + (t.reqNCS || 0));
      hours += manHours;
      byCategory.B1 += t.avgFreqPerMonth * hoursPerOcc * (t.reqB1 || 0);
      byCategory.B2 += t.avgFreqPerMonth * hoursPerOcc * (t.reqB2 || 0);
      byCategory.CM += t.avgFreqPerMonth * hoursPerOcc * (t.reqCM || 0);
      byCategory.NCS += t.avgFreqPerMonth * hoursPerOcc * (t.reqNCS || 0);
      const shifts = (t.preferredShift === "M" || t.preferredShift === "A" || t.preferredShift === "N") ? [t.preferredShift] : ["M", "A", "N"];
      const shiftSplit = 1 / shifts.length;
      shifts.forEach(sh => {
        byShiftCategory[sh].B1 += t.avgFreqPerMonth * hoursPerOcc * (t.reqB1 || 0) * shiftSplit;
        byShiftCategory[sh].B2 += t.avgFreqPerMonth * hoursPerOcc * (t.reqB2 || 0) * shiftSplit;
        byShiftCategory[sh].CM += t.avgFreqPerMonth * hoursPerOcc * (t.reqCM || 0) * shiftSplit;
        byShiftCategory[sh].NCS += t.avgFreqPerMonth * hoursPerOcc * (t.reqNCS || 0) * shiftSplit;
      });
      if (manHours > 0) {
        taskBreakdown.push({
          name: t.name, occurrences: t.avgFreqPerMonth, totalHours: Math.round(manHours * 10) / 10,
          preferredShift: t.preferredShift || "Any",
          byCategory: {
            B1: Math.round(t.avgFreqPerMonth * hoursPerOcc * (t.reqB1 || 0) * 10) / 10,
            B2: Math.round(t.avgFreqPerMonth * hoursPerOcc * (t.reqB2 || 0) * 10) / 10,
            CM: Math.round(t.avgFreqPerMonth * hoursPerOcc * (t.reqCM || 0) * 10) / 10,
            NCS: Math.round(t.avgFreqPerMonth * hoursPerOcc * (t.reqNCS || 0) * 10) / 10,
          },
        });
      }
    });
  }
  // Flat Manpower-Hours Allowance — per-category (unplannedHoursB1/B2/CM/
  // NCS), mirroring the station's own Per-Shift Buffer fields. Previously
  // a single unplannedManpowerHoursPerMonth total got added only to the
  // combined `hours` figure, never to byCategory/byShiftCategory, so it
  // showed up on the Workload Summary panel but fed ZERO actual demand —
  // computeDailyShiftDemand has no way to use a number with no category or
  // shift attached to it. No per-task Preferred Shift exists for a flat
  // allowance, so — same as an "Any"-shift task — it's spread evenly
  // across M/A/N.
  const plannedHoursBy = plannedByCategory || { B1: 0, B2: 0, CM: 0, NCS: 0 };
  let flatByCategory = { B1: 0, B2: 0, CM: 0, NCS: 0 };
  if (config.unplannedMethod === "manpower_hours" || config.unplannedMethod === "both") {
    flatByCategory = {
      B1: config.unplannedHoursB1 || 0, B2: config.unplannedHoursB2 || 0,
      CM: config.unplannedHoursCM || 0, NCS: config.unplannedHoursNCS || 0,
    };
    ["B1", "B2", "CM", "NCS"].forEach(cat => {
      hours += flatByCategory[cat];
      byCategory[cat] += flatByCategory[cat];
      ["M", "A", "N"].forEach(sh => { byShiftCategory[sh][cat] += flatByCategory[cat] / 3; });
    });
    const flatTotal = flatByCategory.B1 + flatByCategory.B2 + flatByCategory.CM + flatByCategory.NCS;
    if (flatTotal > 0) {
      taskBreakdown.push({
        name: "Unplanned Manpower-Hours Allowance", occurrences: null, totalHours: Math.round(flatTotal * 10) / 10,
        preferredShift: "Any", byCategory: { ...flatByCategory },
      });
    }
  }
  const plannedTotalHours = plannedHoursBy.B1 + plannedHoursBy.B2 + plannedHoursBy.CM + plannedHoursBy.NCS;
  const bufferHours = plannedTotalHours * (config.unplannedBufferPct / 100);
  // Buffer % scales with EACH category's own planned load (a category with
  // zero planned hours gets zero buffer, not an even split of someone
  // else's workload) — same "Any"-shift even spread as the flat allowance
  // above, since the buffer isn't tied to any one task's own shift.
  const bufferByCategory = { B1: 0, B2: 0, CM: 0, NCS: 0 };
  ["B1", "B2", "CM", "NCS"].forEach(cat => {
    const catBuffer = plannedHoursBy[cat] * (config.unplannedBufferPct / 100);
    bufferByCategory[cat] = catBuffer;
    byCategory[cat] += catBuffer;
    ["M", "A", "N"].forEach(sh => { byShiftCategory[sh][cat] += catBuffer / 3; });
  });
  if (bufferHours > 0) {
    taskBreakdown.push({
      name: `Unplanned Buffer (${config.unplannedBufferPct}% of planned)`, occurrences: null,
      totalHours: Math.round(bufferHours * 10) / 10, preferredShift: "Any",
      byCategory: {
        B1: Math.round(bufferByCategory.B1 * 10) / 10, B2: Math.round(bufferByCategory.B2 * 10) / 10,
        CM: Math.round(bufferByCategory.CM * 10) / 10, NCS: Math.round(bufferByCategory.NCS * 10) / 10,
      },
    });
  }
  return {
    fromTasksOrAllowance: Math.round(hours * 10) / 10,
    bufferHours: Math.round(bufferHours * 10) / 10,
    totalHours: Math.round((hours + bufferHours) * 10) / 10,
    byCategory, byShiftCategory, taskBreakdown,
    label: "EXPECTED UNPLANNED WORKLOAD — planning estimate, not a confirmed maintenance event",
  };
}

// The single function that answers "why does Morning need 7 people".
// CRITICAL: byShift/totalHours from computeTaskMasterDemand are MONTHLY
// totals — dividing by hoursPerShift alone (a bug present in an earlier
// version) treated an entire month's accumulated task-hours as if they all
// had to be covered within one single 8-hour shift, wildly overstating the
// headcount needed on any given day. Dividing by daysInMonth first
// correctly spreads that monthly total across the days it actually happens
// over.
function computeExplainableManpower(flightSummary, plannedDemand, unplannedDemand, daysInMonth) {
  const shifts = ["M", "A", "N"];
  const hoursPerShift = 8;
  const result = {};
  shifts.forEach(sh => {
    const flightShare = Math.round(((flightSummary.totalMovements || 0) / 3) / 8);
    const plannedShare = Math.round((plannedDemand.byShift?.[sh] || 0) / daysInMonth / hoursPerShift);
    const unplannedShare = Math.round((unplannedDemand.totalHours / daysInMonth / hoursPerShift) / 3);
    const required = flightShare + plannedShare + unplannedShare;
    result[sh] = { flightPdcDemand: flightShare, plannedMaintenance: plannedShare, unplannedReserve: unplannedShare, required };
  });
  return result;
}

// "Average vs Peak Day" per shift — computeDailyShiftDemand's demand object
// already holds a REAL per-day figure for every day of the month (peak
// concurrency within that day's shift window, not a flat monthly average);
// this just reduces that day-by-day series to what the reference PWA's own
// Real Requirement panel shows: the plain average across all days (the
// number a naive "divide the month total by days" calculation would give)
// alongside the actual peak day's figure (what generation itself has to be
// able to cover) — the whole point of surfacing this table is showing how
// far apart those two can be. peakDate is the day whose COMBINED B1+CM+NCS
// demand for that shift is highest, so all three peak figures on one row
// trace back to one real day, not three independently-chosen days.
function computeAveragePeakByShift(demand, daysInMonth) {
  const result = {};
  ["M", "A", "N"].forEach(sh => {
    const cats = { B1: [], CM: [], NCS: [] };
    let peakCombined = -1, peakDay = null;
    for (let d = 1; d <= daysInMonth; d++) {
      const day = demand[d]?.[sh];
      if (!day) continue;
      cats.B1.push(day.B1 || 0);
      cats.CM.push(day.CM || 0);
      cats.NCS.push(day.NCS || 0);
      const combined = (day.B1 || 0) + (day.CM || 0) + (day.NCS || 0);
      if (combined > peakCombined) { peakCombined = combined; peakDay = d; }
    }
    const avg = arr => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0);
    const peak = arr => (arr.length ? Math.max(...arr) : 0);
    result[sh] = {
      B1: { avg: avg(cats.B1), peak: peak(cats.B1) },
      CM: { avg: avg(cats.CM), peak: peak(cats.CM) },
      NCS: { avg: avg(cats.NCS), peak: peak(cats.NCS) },
      peakDay,
    };
  });
  return result;
}

module.exports = {
  findPeakConcurrency, dateAndMinutesToAbsMin, getEffectiveGroundTime,
  buildTransitWorkloadEvents, buildPDCWorkloadEvents, buildClashEvents,
  computeDailyPeaks, computeAutomaticClashes, classifyTimeToShift,
  getManualDemandByDayShift, computeDailyShiftDemand, computeTaskMasterDemand,
  computeUnplannedWorkload, computeExplainableManpower, computeAveragePeakByShift,
};
