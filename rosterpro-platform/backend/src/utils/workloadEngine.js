// Ported verbatim from the RosterPro PWA (RosterProPWA9.zip)'s workload
// engine (transit/PDC classification, clash detection, task-master demand,
// rule scoring). This is the exact area the user flagged as having had
// real bugs fixed before: transit/PDC double-counting, monthly totals
// divided by the wrong denominator, raw movement counts instead of peak
// concurrency. Every comment explaining WHY a line is written the way it
// is has been kept, not summarized away.
const { expandOperatingDates } = require("./flightScheduleParser");

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
      const end = dateAndMinutesToAbsMin(date, rec.outboundDepMin);
      events.push({ start: end - pdcMin, end, date, label: `Flt ${rec.outboundFlt}` });
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
// peak concurrency WITHIN each day.
function computeDailyPeaks(events) {
  const byDate = {};
  events.forEach(e => {
    const key = e.date.toISOString().slice(0, 10);
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
function computeDailyShiftDemand({ year, month, homeStation, baseCoverage, flightSchedule, config, manualDemandEntries, shiftDefs, perShiftBuffer }) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const demand = {};
  const manualByDayShift = getManualDemandByDayShift(manualDemandEntries || [], year, month, shiftDefs);
  const buf = perShiftBuffer || { B1: 0, B2: 0, CM: 0, NCS: 0 };

  for (let d = 1; d <= daysInMonth; d++) {
    const manual = manualByDayShift[d];
    demand[d] = {};
    ["M", "A", "N"].forEach(sh => {
      demand[d][sh] = {
        B1: (baseCoverage[sh] || 0) + (manual?.[sh].B1 || 0) + (buf.B1 || 0),
        CM: (manual?.[sh].CM || 0) + (buf.CM || 0),
        NCS: (manual?.[sh].NCS || 0) + (buf.NCS || 0),
      };
    });
  }

  if (!flightSchedule) {
    return { demand, source: "base-coverage-only", reason: "No flight schedule imported for this exact month — using flat base coverage plus any Manual Demand / per-shift buffer entries." };
  }

  const { turnRecords, charterRecords } = flightSchedule;
  const transitEvents = buildTransitWorkloadEvents(turnRecords, year, month, homeStation, config);
  const pdcEvents = buildPDCWorkloadEvents(turnRecords, charterRecords, year, month, homeStation, config);
  const allEvents = [...transitEvents, ...pdcEvents];
  const ratioB1 = Math.max(1, config.movementsPerB1Staff || 4);
  const ratioCM = Math.max(1, config.movementsPerCMStaff || 1);
  const ratioNCS = Math.max(1, config.movementsPerNCSStaff || 1);

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
        .map(e => ({ start: Math.max(e.start, startAbs), end: Math.min(e.end, endAbs) }));
      const peakConcurrency = findPeakConcurrency(clipped).peak;
      demand[d][sh].B1 = Math.max(baseCoverage[sh] || 0, Math.ceil(peakConcurrency / ratioB1)) + (manual?.[sh].B1 || 0) + (buf.B1 || 0);
      demand[d][sh].CM = Math.ceil(peakConcurrency / ratioCM) + (manual?.[sh].CM || 0) + (buf.CM || 0);
      demand[d][sh].NCS = Math.ceil(peakConcurrency / ratioNCS) + (manual?.[sh].NCS || 0) + (buf.NCS || 0);
    });
  }
  return { demand, source: "flight-schedule-driven", reason: `Derived from ${allEvents.length} real transit/PDC events, using PEAK CONCURRENCY per shift (B1 1-per-${ratioB1}, CM 1-per-${ratioCM}, NCS 1-per-${ratioNCS}), plus Manual Demand and the per-shift unplanned buffer.` };
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
    if (occurrences > 0) taskBreakdown.push({ name: t.name, occurrences: Math.round(occurrences * 10) / 10, totalHours: Math.round(taskTotalHours * 10) / 10, preferredShift: t.preferredShift || "Any" });
  });
  return { totalHours: Math.round(totalHours * 10) / 10, byCategory, byShift, byShiftCategory, taskBreakdown };
}

// Unplanned workload supports frequency-based, manpower-hour-based, or
// both (summed), plus a configurable buffer % applied on top of the
// PLANNED workload total.
function computeUnplannedWorkload(unplannedTaskMaster, config, plannedTotalHours) {
  let hours = 0;
  const byCategory = { B1: 0, B2: 0, CM: 0, NCS: 0 };
  if (config.unplannedMethod === "frequency" || config.unplannedMethod === "both") {
    unplannedTaskMaster.forEach(t => {
      const hoursPerOcc = (t.avgDurationMin || 0) / 60;
      const manHours = t.avgFreqPerMonth * hoursPerOcc * ((t.reqB1 || 0) + (t.reqB2 || 0) + (t.reqCM || 0) + (t.reqNCS || 0));
      hours += manHours;
      byCategory.B1 += t.avgFreqPerMonth * hoursPerOcc * (t.reqB1 || 0);
      byCategory.B2 += t.avgFreqPerMonth * hoursPerOcc * (t.reqB2 || 0);
      byCategory.CM += t.avgFreqPerMonth * hoursPerOcc * (t.reqCM || 0);
      byCategory.NCS += t.avgFreqPerMonth * hoursPerOcc * (t.reqNCS || 0);
    });
  }
  if (config.unplannedMethod === "manpower_hours" || config.unplannedMethod === "both") {
    hours += config.unplannedManpowerHoursPerMonth;
  }
  const bufferHours = plannedTotalHours * (config.unplannedBufferPct / 100);
  return {
    fromTasksOrAllowance: Math.round(hours * 10) / 10,
    bufferHours: Math.round(bufferHours * 10) / 10,
    totalHours: Math.round((hours + bufferHours) * 10) / 10,
    byCategory,
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

module.exports = {
  findPeakConcurrency, dateAndMinutesToAbsMin, getEffectiveGroundTime,
  buildTransitWorkloadEvents, buildPDCWorkloadEvents, buildClashEvents,
  computeDailyPeaks, computeAutomaticClashes, classifyTimeToShift,
  getManualDemandByDayShift, computeDailyShiftDemand, computeTaskMasterDemand,
  computeUnplannedWorkload, computeExplainableManpower,
};
