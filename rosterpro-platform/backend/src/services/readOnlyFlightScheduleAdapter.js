// ═══════════════════════════════════════════════════════════════════════════
// TASK ALLOCATION MODULE — read-only adapter onto the EXISTING Flights
// module (Rostering's day-by-day Flight list, imported via the Flight
// Schedule Template — see flightImportService.js / FlightsPage.jsx). Same
// isolation convention as readOnlyRosterAdapter.js: read-only, calls an
// already-exported repository function, never a raw query of its own
// against Flights' tables and never a reimplementation of its logic (the
// one addition, flightRepository.listFlightsForStationByDate, was needed
// because every existing read there filters on scheduledIn alone, which
// would silently drop an outbound-only flight — see its own comment).
// ═══════════════════════════════════════════════════════════════════════════
const flightRepo = require("../repositories/flightRepository");

function startOfDay(d) { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setUTCHours(23, 59, 59, 999); return x; }

// Every Flight touching the given calendar date at this station, mapped
// into the shape Task Allocation's Flight Instance sync needs. A Flight
// with no Aircraft linked yet (aircraftId is nullable) has no registration
// to give Task Allocation — which exists specifically to answer "which tail
// is on stand X" — so those are reported separately as `skipped` rather
// than synced as a row with a blank required field.
async function getFlightsForStationDate(stationId, date) {
  const flights = await flightRepo.listFlightsForStationByDate(stationId, startOfDay(date), endOfDay(date));
  const rows = [];
  let skippedNoAircraft = 0;
  for (const f of flights) {
    if (!f.aircraft?.registration) { skippedNoAircraft++; continue; }
    rows.push({
      flightNumber: f.flightNumber,
      aircraftRegistration: f.aircraft.registration,
      aircraftType: f.aircraft.type || null,
      std: f.scheduledOut || null,
      sta: f.scheduledIn || null,
      etd: f.actualOut || null,
      eta: f.actualIn || null,
    });
  }
  return { rows, skippedNoAircraft };
}

module.exports = { getFlightsForStationDate };
