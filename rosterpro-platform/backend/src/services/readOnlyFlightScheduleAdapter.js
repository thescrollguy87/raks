// ═══════════════════════════════════════════════════════════════════════════
// TASK ALLOCATION MODULE — read-only adapter onto the EXISTING Flight
// Schedule module (the monthly Turn Report / Charter import —
// flightScheduleService.js, TurnRecord/CharterRecord — what Daily Coverage,
// PDC, Transit and Departure Clash all already run on, and confirmed as
// this station's actually-populated flight data). Same isolation
// convention as readOnlyRosterAdapter.js: read-only, calls already-exported
// functions, never a raw query of its own and never a reimplementation of
// workloadEngine's own classification logic (getEffectiveGroundTime is
// imported, not re-derived).
//
// IMPORTANT — the Turn Report has NO registration, stand, or terminal field
// at all (see schema.prisma's TaskAllocationFlightInstance comment): a
// synced row only ever carries flight number + schedule times + a
// best-guess Transit/PDC split. Registration, stand and terminal are
// filled in by hand (Section 6) same as before — they were never going to
// come from an auto-fetch, this module just brings over everything that
// genuinely CAN be read from an existing source instead of hand-typing it.
// ═══════════════════════════════════════════════════════════════════════════
const rosterRepo = require("../repositories/rosterRepository");
const flightScheduleService = require("./flightScheduleService");
const workloadConfigService = require("./workloadConfigService");
const { getEffectiveGroundTime } = require("../utils/workloadEngine");

// Task Allocation stores every date/time as a "wall-clock stamped as UTC"
// Date (see eligibilityEngineService.js's combineDateAndTime, and the
// manual-entry frontend's own `${date}T${hh}:00.000Z` construction) — a
// DIFFERENT convention from flightScheduleParser/workloadEngine's LOCAL
// Date construction (Issue #12's day-boundary fix). `utcDate` here is the
// sync target in Task Allocation's own convention; `localDateForSchedule`
// re-expresses the SAME calendar day in the Turn Report's convention
// purely to check operating-day membership — never mixed with the other.
function localDateForSchedule(utcDate) {
  return new Date(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate());
}
function operatesOnLocalDate(effDate, discDate, daysOfWeek, localDate) {
  if (!effDate || !discDate || !daysOfWeek) return false;
  if (localDate < effDate || localDate > discDate) return false;
  const isoDow = localDate.getDay() === 0 ? 7 : localDate.getDay(); // Sun=0..Sat=6 -> Mon=1..Sun=7
  return !!daysOfWeek.days[isoDow - 1];
}
function wallClockTime(utcDate, minutesOfDay, dayOffset = 0) {
  if (minutesOfDay === null || minutesOfDay === undefined) return null;
  const h = Math.floor(minutesOfDay / 60), m = minutesOfDay % 60;
  return new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate() + dayOffset, h, m, 0, 0));
}
function prevMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// Every Turn Report / Charter row operating on the given calendar date at
// this station, mapped into the shape Task Allocation's Flight Instance
// sync needs. Falls back to the most recent PREVIOUS month's import when
// nothing's been imported for the target month yet — same convention
// rosterGenerationService.js already uses for workload demand, so Flight
// Instance sync doesn't go quiet on a day nobody's re-imported this month's
// file for.
async function getFlightsForStationDate(stationId, utcDate) {
  const localDate = localDateForSchedule(utcDate);
  const year = localDate.getFullYear(), month = localDate.getMonth() + 1;

  const [station, config] = await Promise.all([rosterRepo.findStationById(stationId), workloadConfigService.getWorkloadConfig(stationId)]);
  const homeStation = station?.iataCode;
  const threshold = config.transitVsPdcThresholdMinutes;

  let schedule = await flightScheduleService.getFlightScheduleForMonth(stationId, year, month);
  if (!schedule) {
    const { year: py, month: pm } = prevMonth(year, month);
    const prev = await flightScheduleService.getFlightScheduleForMonth(stationId, py, pm);
    if (prev) {
      // Each record's effectiveDate/discontinueDate were scoped to the
      // month it was imported for — re-anchor to span the target month so
      // the same days-of-week pattern recurs onto today's real calendar.
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0);
      const reanchor = rec => ({ ...rec, effectiveDate: monthStart, discontinueDate: monthEnd });
      schedule = { turnRecords: prev.turnRecords.map(reanchor), charterRecords: prev.charterRecords.map(reanchor) };
    }
  }
  if (!schedule) return { rows: [] };

  const rows = [];
  for (const rec of schedule.turnRecords) {
    if (!operatesOnLocalDate(rec.effectiveDate, rec.discontinueDate, rec.daysOfWeek, localDate)) continue;
    const arrivesHere = homeStation && rec.inboundArrSta === homeStation;
    const departsHere = homeStation && rec.outboundDepSta === homeStation;
    if (!arrivesHere && !departsHere) continue; // a row for a different station in a multi-station Turn Report
    const groundTime = getEffectiveGroundTime(rec);
    // Same overnight-crossing check as buildPDCWorkloadEvents: a departure
    // whose minute-of-day is <= the arrival's belongs to the NEXT calendar
    // day (aircraft arrives late, works through/past midnight).
    const depWraps = arrivesHere && departsHere && rec.outboundDepMin !== null && rec.outboundDepMin <= rec.inboundArrMin;
    rows.push({
      flightNumber: (departsHere ? rec.outboundFlt : rec.inboundFlt) || rec.inboundFlt || rec.outboundFlt || "—",
      aircraftRegistration: null, aircraftType: null,
      std: departsHere ? wallClockTime(utcDate, rec.outboundDepMin, depWraps ? 1 : 0) : null,
      sta: arrivesHere ? wallClockTime(utcDate, rec.inboundArrMin) : null,
      etd: null, eta: null,
      isTransit: groundTime !== null && groundTime <= threshold,
    });
  }
  for (const rec of schedule.charterRecords) {
    if (!operatesOnLocalDate(rec.effectiveDate, rec.discontinueDate, rec.daysOfWeek, localDate)) continue;
    const departsHere = homeStation && rec.depSta === homeStation;
    const arrivesHere = homeStation && rec.arrSta === homeStation;
    if (!departsHere && !arrivesHere) continue;
    rows.push({
      flightNumber: rec.flightDesg || "—",
      aircraftRegistration: null, aircraftType: null,
      std: departsHere ? wallClockTime(utcDate, rec.depMin) : null,
      sta: arrivesHere ? wallClockTime(utcDate, rec.arrMin) : null,
      etd: null, eta: null,
      isTransit: false,
    });
  }
  return { rows };
}

module.exports = { getFlightsForStationDate };
