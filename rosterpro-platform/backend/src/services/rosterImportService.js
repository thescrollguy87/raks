const ExcelJS = require("exceljs");
const rosterRepo = require("../repositories/rosterRepository");
const rosterService = require("./rosterService");
const ApiError = require("../utils/ApiError");
const { resolveAirlineId } = require("../utils/stationScope");
const { LEADING_COLUMNS, LEGEND_SENTINEL, stripNameSuffix, findHeaderRowIndex, findDateRowIndex } = require("../utils/rosterFileFormat");

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function dateAt(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toISOString().slice(0, 10);
}

// Resolves ExcelJS's 1-indexed, leading-empty-slot row.values into a plain
// 0-indexed array, and unwraps formula/rich-text cells down to the plain
// value a person would actually read on screen.
function sheetToRows(ws) {
  const rows = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    rows.push(ws.getRow(r).values.slice(1).map(cellPlainValue));
  }
  return rows;
}
function cellPlainValue(v) {
  if (v === undefined) return null;
  if (v && typeof v === "object") {
    if (v instanceof Date) return v;
    if (typeof v.result !== "undefined") return v.result;
    if (typeof v.text !== "undefined") return v.text;
    if (Array.isArray(v.richText)) return v.richText.map(rt => rt.text).join("");
  }
  return v;
}

// Reads the real Monthly Roster layout — see utils/rosterFileFormat.js for
// the full shape (S/N, Staff Name, Designation, Staff ID, then a date per
// day, with a title+date row, a weekday row, and a trailing "Legends"
// section this never treats as staff data). Matches rows to EXISTING
// active staff at the station by Staff ID (Employee ID) first, falling
// back to a name match with any "(...)" suffix stripped — it does NOT
// create new staff from unmatched rows: a real account needs a login/
// email/role, which isn't something a roster spreadsheet carries, so
// unmatched rows are reported back for the caller to add via Staff
// Registry first, rather than silently fabricated.
async function importRoster(stationId, monthKey, buffer, actor, req) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw ApiError.badRequest("Couldn't read that file — expected a .xlsx roster file");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw ApiError.badRequest("The file has no worksheet");

  const rows = sheetToRows(ws);
  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex === -1) {
    throw ApiError.badRequest("Could not find the header row (looking for \"S/N\" and \"Staff Name\" columns) — is this a Monthly Roster file?");
  }
  const dateRowIndex = findDateRowIndex(rows, headerRowIndex);
  if (dateRowIndex === -1) {
    throw ApiError.badRequest("Could not find the row of dates above the header — is this a Monthly Roster file?");
  }

  const dateRow = rows[dateRowIndex];
  const nDays = daysInMonth(monthKey);
  const fileDayCount = dateRow.slice(LEADING_COLUMNS).filter(v => v instanceof Date).length;
  if (fileDayCount !== nDays) {
    throw ApiError.badRequest(
      `File has ${fileDayCount} day columns but ${monthKey} has ${nDays} days — import into the same month the file is for.`
    );
  }

  const [staff, shiftDefs] = await Promise.all([
    rosterRepo.getActiveStaffForGeneration(stationId),
    rosterRepo.findAllShiftDefs(await resolveAirlineId(actor, stationId)),
  ]);
  const validCodes = new Set(shiftDefs.map(d => d.code));
  const byEmployeeId = new Map(staff.filter(s => s.employeeId).map(s => [s.employeeId, s]));
  const byName = new Map(staff.map(s => [stripNameSuffix(s.fullName).toUpperCase(), s]));

  const assignments = [];
  const notFound = [];
  const invalidCodes = new Set();
  const seenInFile = new Map();
  const duplicates = [];
  const sortOrders = []; // { userId, order } — this row's position in the file, for matched staff only
  let matchedRows = 0;
  let nextOrder = 0;

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const firstCell = row[0];
    if (typeof firstCell === "string" && firstCell.trim().toLowerCase() === LEGEND_SENTINEL) break; // staff data ends here
    const rawName = row[1];
    if (!rawName || !String(rawName).trim()) continue; // blank spacer row between staff

    const employeeId = row[3] ? String(row[3]).trim() : "";
    const name = stripNameSuffix(rawName);
    if (!name) continue;
    const dupKey = employeeId || name.toUpperCase();
    const fileRowNum = i + 1; // back to a 1-indexed row number for messages
    if (seenInFile.has(dupKey)) {
      duplicates.push(`${name} (row ${fileRowNum}, first seen row ${seenInFile.get(dupKey)})`);
    } else {
      seenInFile.set(dupKey, fileRowNum);
    }

    const match = (employeeId && byEmployeeId.get(employeeId)) || byName.get(name.toUpperCase());
    if (!match) { notFound.push(name); continue; }
    matchedRows++;
    sortOrders.push({ userId: match.id, order: nextOrder++ });

    for (let day = 1; day <= nDays; day++) {
      const cell = row[LEADING_COLUMNS + day - 1];
      // A cell holding only whitespace (real files use these as filler past
      // where a person's data actually ends, e.g. someone who left mid-file)
      // means the same as a genuinely blank cell — default to "O", don't
      // report it as an unrecognized code.
      const raw = cell ? String(cell).trim() : "";
      if (!raw) { assignments.push({ userId: match.id, shiftDate: dateAt(monthKey, day), shiftCode: "O" }); continue; }
      const code = raw.toUpperCase();
      if (!validCodes.has(code)) { invalidCodes.add(code); continue; }
      assignments.push({ userId: match.id, shiftDate: dateAt(monthKey, day), shiftCode: code });
    }
  }

  // Record the file's row order even for a re-import that changes nothing
  // else (e.g. re-running the same file) — the Shift Roster grid reads this
  // to show staff in the order the station actually manages them, not
  // always alphabetical.
  if (sortOrders.length) await rosterRepo.updateRosterSortOrders(sortOrders);

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
