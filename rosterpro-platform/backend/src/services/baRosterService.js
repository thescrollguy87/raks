const ExcelJS = require("exceljs");
const rosterRepo = require("../repositories/rosterRepository");
const ApiError = require("../utils/ApiError");

// Matches the airport ground-staff access system's own upload template
// (Ground_Staff_Roster_April_2026.xlsx — column names, plain unstyled
// header): one row per staff member per day they're actually on duty.
// "Shift Role" is a fixed label per the portal's own spec — every row is
// "Ground Staff" regardless of the person's real category/designation —
// and "Roster End Date/Month/Year" is always the same calendar day as
// "Roster Date/Month/Year" (the portal has no concept of an overnight
// shift spanning two dates).
const BA_EXPORT_HEADER = [
  "Employee Number", "Roster Date", "Roster Month", "Roster Year",
  "Roster End Date", "Roster End Month", "Roster End Year",
  "Shift Role", "Shift Start Time", "Shift End Time",
];
const SHIFT_ROLE = "Ground Staff";

// "06:30" -> "0630". The portal expects a zero-padded 4-digit time, not a
// bare number (which would silently drop the leading zero on a morning shift).
function toBATime(hhmm) {
  return hhmm.replace(":", "").padStart(4, "0");
}

function monthKeyOf(dateStr) { return dateStr.slice(0, 7); }

// Same B1/B2/CM/NCS/STO grouping order the Staff Registry and Roster grid
// UI use, so the exported file reads the same way the app already does.
const CATEGORY_ORDER = ["B1", "B2", "CM", "NCS", "STO"];
function byCategoryThenName(staff) {
  return [...staff].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category || "NCS");
    const cb = CATEGORY_ORDER.indexOf(b.category || "NCS");
    if (ca !== cb) return ca - cb;
    return a.fullName.localeCompare(b.fullName);
  });
}

async function buildBARosterRows(stationId, dateStr) {
  const monthKey = monthKeyOf(dateStr);
  const [y, m, d] = dateStr.split("-").map(Number);

  const roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  if (!roster) {
    throw ApiError.notFound(`No roster exists for ${monthKey} yet — generate or create it first.`);
  }

  const staff = byCategoryThenName(await rosterRepo.getRosterGrid(stationId, roster.id));
  const rows = [];

  for (const s of staff) {
    const todayShift = s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr);
    if (!todayShift) continue;
    const def = todayShift.shiftDef;
    if (def.type !== "duty" && def.type !== "night") continue; // BA roster = who's actually reporting for duty
    // A per-day override (in1/out1) takes priority over the definition's
    // default times — e.g. a manually retimed shift for this one date.
    const startTime = todayShift.in1 || def.startTime;
    const endTime = todayShift.out1 || def.endTime;
    if (!startTime || !endTime) continue; // shift types with no real time can't produce a valid row
    if (!s.employeeId) continue; // no way to identify this person to the portal without one — e.g. a test/admin account with a stray shift assignment but no real Staff Registry record

    rows.push([
      s.employeeId,
      d, m, y,
      d, m, y, // "Roster End Date" — always the same day as "Roster Date" (no overnight-shift adjustment)
      SHIFT_ROLE,
      toBATime(startTime), toBATime(endTime),
    ]);
  }

  return rows;
}

async function generateBARosterExcel(stationId, dateStr) {
  const rows = await buildBARosterRows(stationId, dateStr);
  if (!rows.length) throw ApiError.badRequest("No staff are on duty that day — nothing to export");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Roster");
  ws.addRow(BA_EXPORT_HEADER);
  rows.forEach(r => ws.addRow(r));

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, rowCount: rows.length, filename: `BA_Roster_${dateStr}.xlsx` };
}

module.exports = { buildBARosterRows, generateBARosterExcel };
