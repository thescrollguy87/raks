const ExcelJS = require("exceljs");
const repo = require("../repositories/flightScheduleRepository");
const auditTrail = require("../utils/auditTrail");
const ApiError = require("../utils/ApiError");
const {
  decodeDaysOfWeek, parseTurnReportRows, parseCharterRows,
  computeFlightWorkloadSummary, buildDailyFlightSchedule,
} = require("../utils/flightScheduleParser");

// Converts a worksheet into the plain array-of-arrays shape
// flightScheduleParser's functions expect — resolving formula results and
// rich-text runs down to their plain value, since the parser only ever
// looks at what a cell WOULD read as on screen (a number, a string, a
// Date), never ExcelJS's richer cell-object wrapper.
function sheetToRows(ws) {
  const rows = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const raw = ws.getRow(r).values.slice(1); // row.values is 1-indexed with a leading empty slot
    rows.push(raw.map(cellPlainValue));
  }
  return rows;
}

function cellPlainValue(v) {
  if (v === undefined) return null;
  if (v && typeof v === "object") {
    if (v instanceof Date) return v;
    if (typeof v.result !== "undefined") return v.result; // formula cell
    if (typeof v.text !== "undefined") return v.text; // rich text
    if (Array.isArray(v.richText)) return v.richText.map(rt => rt.text).join("");
  }
  return v;
}

// The Turn Report and Charter sheet may be two tabs in the same workbook or
// two different files historically — scanning every worksheet for whichever
// one actually contains each header (by content, same principle as
// findHeaderRow itself) means the import doesn't care which tab order or
// naming convention the export used.
async function importFlightSchedule(stationId, year, month, buffer, actor, req) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw ApiError.badRequest("Couldn't read that file — expected a .xlsx file");
  }
  if (!wb.worksheets.length) throw ApiError.badRequest("The file has no worksheet");

  let turnResult = null;
  let charterResult = { records: [], error: null };
  for (const ws of wb.worksheets) {
    const rows = sheetToRows(ws);
    const t = parseTurnReportRows(rows);
    if (t.error === null) turnResult = t;
    const c = parseCharterRows(rows);
    if (c.records.length) charterResult = c;
  }
  if (!turnResult) {
    throw ApiError.badRequest("Could not find the Turn Report header row (looking for 'Inbound Aln') — is this the right sheet/file?");
  }

  const imp = await repo.upsertImport({
    stationId, year, month,
    turnRows: turnResult.records, charterRows: charterResult.records,
    actorId: actor.sub,
  });

  await auditTrail.logActivity(
    "Flight schedule imported",
    `${year}-${String(month).padStart(2, "0")}: ${turnResult.records.length} turn row(s), ${charterResult.records.length} charter row(s)`,
    stationId, actor, req,
  );

  return { importId: imp.id, turnRowCount: turnResult.records.length, charterRowCount: charterResult.records.length };
}

// Reconstructs the shapes flightScheduleParser/workloadEngine expect from
// the flat DB rows — daysOfWeekPattern is stored as the already-decoded
// 7-char string, so decodeDaysOfWeek just re-derives the `.days` boolean
// array from it (feeding a valid pattern string back through it is a no-op
// round trip, not a re-decode of the original Excel quirks).
async function getFlightScheduleForMonth(stationId, year, month) {
  const imp = await repo.findImport(stationId, year, month);
  if (!imp) return null;
  const turnRecords = imp.turnRecords.map(r => ({ ...r, daysOfWeek: decodeDaysOfWeek(r.daysOfWeekPattern) }));
  const charterRecords = imp.charterRecords.map(r => ({ ...r, daysOfWeek: decodeDaysOfWeek(r.daysOfWeekPattern) }));
  return { turnRecords, charterRecords, importedAt: imp.importedAt, turnRowCount: imp.turnRowCount, charterRowCount: imp.charterRowCount };
}

async function getFlightScheduleView(stationId, year, month) {
  const schedule = await getFlightScheduleForMonth(stationId, year, month);
  if (!schedule) return { imported: false };
  const { turnRecords, charterRecords } = schedule;
  const daily = buildDailyFlightSchedule(turnRecords, charterRecords, year, month);
  const summary = computeFlightWorkloadSummary(turnRecords, charterRecords, year, month);
  return { imported: true, importedAt: schedule.importedAt, ...daily, summary };
}

module.exports = { importFlightSchedule, getFlightScheduleForMonth, getFlightScheduleView };
