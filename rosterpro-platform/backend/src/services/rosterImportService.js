const ExcelJS = require("exceljs");
const rosterRepo = require("../repositories/rosterRepository");
const rosterService = require("./rosterService");
const ApiError = require("../utils/ApiError");

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function dateAt(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toISOString().slice(0, 10);
}

// Reads the same layout getRosterReportData's Excel export produces
// (Employee ID, Name, Category, Designation, then one column per day) so
// exporting a roster, editing it in Excel, and re-importing round-trips
// cleanly. Matches rows to EXISTING active staff at the station by Employee
// ID first, falling back to an exact case-insensitive name match — it does
// NOT create new staff from unmatched rows (unlike the original prototype,
// which had no real accounts to match against): a real account needs a
// login/email/role, which isn't something a roster spreadsheet carries, so
// unmatched rows are reported back for the caller to add via Staff Registry
// first, rather than silently fabricated.
async function importRoster(stationId, monthKey, buffer, actor, req) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw ApiError.badRequest("Couldn't read that file — expected a .xlsx roster export");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw ApiError.badRequest("The file has no worksheet");

  const headerRow = ws.getRow(1).values.slice(1); // exceljs rows are 1-indexed with a leading empty slot
  const LEADING_COLUMNS = 4; // Employee ID, Name, Category, Designation
  if (!headerRow.length || headerRow.length <= LEADING_COLUMNS) {
    throw ApiError.badRequest("That file doesn't look like a RosterPro roster export (missing header row/columns)");
  }

  const nDays = daysInMonth(monthKey);
  const fileDayCount = headerRow.length - LEADING_COLUMNS;
  if (fileDayCount !== nDays) {
    throw ApiError.badRequest(
      `File has ${fileDayCount} day columns but ${monthKey} has ${nDays} days — import into the same month the file was exported from.`
    );
  }

  const [staff, shiftDefs] = await Promise.all([
    rosterRepo.getActiveStaffForGeneration(stationId),
    rosterRepo.findAllShiftDefs(actor.airlineId),
  ]);
  const validCodes = new Set(shiftDefs.map(d => d.code));
  const byEmployeeId = new Map(staff.filter(s => s.employeeId).map(s => [s.employeeId, s]));
  const byName = new Map(staff.map(s => [s.fullName.trim().toUpperCase(), s]));

  const assignments = [];
  const notFound = [];
  const invalidCodes = new Set();
  const seenInFile = new Map();
  const duplicates = [];
  let matchedRows = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r).values.slice(1);
    if (!row.length || !row[1]) continue; // row[1] = Name (row[0] = Employee ID, may be blank)

    const employeeId = row[0] ? String(row[0]).trim() : "";
    const name = String(row[1]).trim();
    const dupKey = employeeId || name.toUpperCase();
    if (seenInFile.has(dupKey)) {
      duplicates.push(`${name} (row ${r}, first seen row ${seenInFile.get(dupKey)})`);
    } else {
      seenInFile.set(dupKey, r);
    }

    const match = (employeeId && byEmployeeId.get(employeeId)) || byName.get(name.toUpperCase());
    if (!match) { notFound.push(name); continue; }
    matchedRows++;

    for (let day = 1; day <= nDays; day++) {
      const cell = row[LEADING_COLUMNS + day];
      const code = cell ? String(cell).trim().toUpperCase() : "O";
      if (!validCodes.has(code)) { invalidCodes.add(code); continue; }
      assignments.push({ userId: match.id, shiftDate: dateAt(monthKey, day), shiftCode: code });
    }
  }

  if (!assignments.length) {
    return { staffUpdated: 0, assignmentCount: 0, notFound: [...new Set(notFound)], invalidCodes: [...invalidCodes], duplicates };
  }

  await rosterService.bulkUpsertShifts({ stationId, monthKey, assignments }, actor, req);

  return {
    staffUpdated: matchedRows,
    assignmentCount: assignments.length,
    notFound: [...new Set(notFound)],
    invalidCodes: [...invalidCodes],
    duplicates,
  };
}

module.exports = { importRoster };
