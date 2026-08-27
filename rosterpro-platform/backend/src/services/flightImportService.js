const ExcelJS = require("exceljs");
const flightRepo = require("../repositories/flightRepository");
const auditTrail = require("../utils/auditTrail");
const { buildStyledSheet } = require("../utils/xlsxBuilder");
const { findHeaderRowIndex } = require("../utils/xlsxParser");
const ApiError = require("../utils/ApiError");

const HEADER = ["Flight Number", "Aircraft Registration", "Scheduled Arrival (HH:MM)", "Scheduled Departure (HH:MM)", "Days of Operation"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_TOKENS = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

function generateTemplate() {
  const legend = "Days of Operation: comma-separated (Mon,Tue,Wed,Thu,Fri,Sat,Sun) or \"Daily\". At least one of Arrival/Departure time is required per row. The target month and station are chosen on the Import/Export screen, not in this file.";
  const exampleRows = [
    ["6E202", "VT-ABC", "14:20", "15:10", "Mon,Wed,Fri"],
    ["6E205", "", "", "09:00", "Daily"],
  ];
  return buildStyledSheet("Flight Schedule Template", HEADER, exampleRows, { legend });
}

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function parseDaysOfOperation(text) {
  const trimmed = String(text || "").trim().toUpperCase();
  if (!trimmed) return { days: new Set(), unknown: [] };
  if (trimmed === "DAILY") return { days: new Set([0, 1, 2, 3, 4, 5, 6]), unknown: [] };
  const tokens = trimmed.split(",").map(t => t.trim()).filter(Boolean);
  const days = new Set();
  const unknown = [];
  for (const t of tokens) {
    const key = t.slice(0, 3);
    if (key in DAY_TOKENS) days.add(DAY_TOKENS[key]);
    else unknown.push(t);
  }
  return { days, unknown };
}

function combine(y, m, day, hhmm) {
  const [h, min] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, day, h, min));
}

// Expands a recurring "days of operation" pattern into individual Flight
// rows for every matching date in the target month, rather than modeling
// the recurrence itself as a persistent entity — the Flight model has no
// recurrence fields (schema.prisma), and this mirrors how rosterImportService
// already expands "one column per day" into individual ShiftAssignment
// rows without needing a "recurring shift" model of its own. Idempotent:
// re-running the same file for the same month updates the same flights
// instead of duplicating them, keyed by (station, flight number, calendar
// day within the month) — anchored on the departure date when a row gives
// one, since that's the industry convention for "day of operation."
async function importFlightSchedule(stationId, monthKey, airlineId, buffer, actor, req) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw ApiError.badRequest("Couldn't read that file — expected a .xlsx file");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw ApiError.badRequest("The file has no worksheet");

  const headerRowIndex = findHeaderRowIndex(ws, "Flight Number");
  if (!headerRowIndex) {
    throw ApiError.badRequest("That file doesn't look like a flight schedule import — expected columns: Flight Number, Aircraft Registration, Scheduled Arrival, Scheduled Departure, Days of Operation");
  }

  const nDays = daysInMonth(monthKey);
  const [y, m] = monthKey.split("-").map(Number);

  const parsedRows = [];
  const errors = [];

  for (let r = headerRowIndex + 1; r <= ws.rowCount; r++) {
    const raw = ws.getRow(r).values.slice(1);
    if (!raw.length || !raw.some(v => v !== undefined && v !== null && String(v).trim() !== "")) continue; // blank row

    const flightNumber = raw[0] ? String(raw[0]).trim().toUpperCase() : "";
    const aircraftReg = raw[1] ? String(raw[1]).trim() : "";
    const arrival = raw[2] ? String(raw[2]).trim() : "";
    const departure = raw[3] ? String(raw[3]).trim() : "";
    const daysText = raw[4] ? String(raw[4]).trim() : "";

    if (!flightNumber) { errors.push(`Row ${r}: Flight Number is required`); continue; }
    if (!arrival && !departure) { errors.push(`Row ${r} (${flightNumber}): at least one of Scheduled Arrival / Scheduled Departure is required`); continue; }
    if (arrival && !TIME_RE.test(arrival)) errors.push(`Row ${r} (${flightNumber}): Scheduled Arrival must be HH:MM (24-hour)`);
    if (departure && !TIME_RE.test(departure)) errors.push(`Row ${r} (${flightNumber}): Scheduled Departure must be HH:MM (24-hour)`);

    const { days, unknown } = parseDaysOfOperation(daysText);
    if (unknown.length) errors.push(`Row ${r} (${flightNumber}): unrecognized Days of Operation value(s): ${unknown.join(", ")}`);
    if (!days.size && !unknown.length) errors.push(`Row ${r} (${flightNumber}): Days of Operation is required (e.g. "Mon,Wed,Fri" or "Daily")`);

    parsedRows.push({ r, flightNumber, aircraftReg, arrival, departure, days });
  }

  if (!parsedRows.length && !errors.length) throw ApiError.badRequest("No flight rows found in that file");
  // All-or-nothing: a monthly schedule is structural (every date it expands
  // to depends on it being read correctly), so a bad row anywhere blocks
  // the whole file rather than partially applying it.
  if (errors.length) throw ApiError.badRequest("Fix the following and re-upload — nothing was imported.", errors);

  // Resolve each unique aircraft registration once.
  const aircraftByReg = new Map();
  const aircraftNotFound = new Set();
  for (const reg of new Set(parsedRows.map(row => row.aircraftReg).filter(Boolean))) {
    const aircraft = await flightRepo.findAircraftByRegistration(airlineId, reg);
    if (aircraft) aircraftByReg.set(reg, aircraft);
    else aircraftNotFound.add(reg);
  }

  const rangeStart = new Date(Date.UTC(y, m - 1, 1));
  const rangeEnd = new Date(Date.UTC(y, m - 1, nDays + 1));

  let created = 0, updated = 0, occurrenceCount = 0;

  for (const row of parsedRows) {
    const existing = await flightRepo.findFlightsByNumberInRange(stationId, row.flightNumber, rangeStart, rangeEnd);
    const existingByDay = new Map();
    for (const f of existing) {
      const anchor = f.scheduledOut || f.scheduledIn;
      if (anchor) existingByDay.set(anchor.getUTCDate(), f);
    }
    const aircraftId = row.aircraftReg ? aircraftByReg.get(row.aircraftReg)?.id || null : null;

    for (let day = 1; day <= nDays; day++) {
      const weekday = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
      if (!row.days.has(weekday)) continue;
      occurrenceCount++;

      const scheduledIn = row.arrival ? combine(y, m, day, row.arrival) : null;
      const scheduledOut = row.departure ? combine(y, m, day, row.departure) : null;
      const data = { airlineId, stationId, aircraftId, flightNumber: row.flightNumber, scheduledIn, scheduledOut, updatedById: actor.sub };

      const match = existingByDay.get(day);
      if (match) {
        await flightRepo.updateFlightSchedule(match.id, data);
        updated++;
      } else {
        const flight = await flightRepo.createFlight({ ...data, createdById: actor.sub });
        await auditTrail.recordCreate("Flight", flight.id, stationId, actor, req);
        created++;
      }
    }
  }

  await auditTrail.logActivity(
    "Flight schedule imported", `${monthKey}: ${created} created, ${updated} updated (${occurrenceCount} occurrences across ${parsedRows.length} route pattern(s))`,
    stationId, actor, req
  );

  return { created, updated, occurrenceCount, aircraftNotFound: [...aircraftNotFound] };
}

module.exports = { generateTemplate, importFlightSchedule };
