const ExcelJS = require("exceljs");
const rosterRepo = require("../repositories/rosterRepository");
const ApiError = require("../utils/ApiError");

// Ports the Daily BA (Breath Analyser) Roster export from the reference PWA
// (RosterPro-PWA/index.html — buildBARosterRows/exportBARoster) onto real
// data: same column layout/order, same header text (incl. embedded line
// breaks), same "0630"-style zero-padded text time format, same header
// styling (measured from the airline's actual BA roster upload template),
// so the exported file uploads to the BA test portal without reformatting.
const BA_EXPORT_HEADER = [
  "Staff No", "First Name", "Last Name", "Email ID", "Designation/Function", "Department", "Location",
  "Roster Date\n(Numeric)", "Roster Month\n(Numeric)", "Roster Year\n(Numeric)",
  "ShiftTime\nStart\n(0000-2359)", "ShiftTime\nEnd\n(0000-2359)", "Shift",
  "Roster EndDate\n(Numeric)", "Roster EndMonth\n(Numeric)", "Roster EndYear\n(Numeric)",
];
const COLUMN_WIDTHS = [8.2, 27, 14.4, 32.7, 20.4, 11.7, 9, 11, 11.3, 10.8, 11.3, 11, 15.9, 11.2, 11.6, 12.1];
const WRAP_COLUMNS = new Set([8, 9, 10, 11, 12, 14, 15, 16]); // 1-indexed — header cells with embedded line breaks

// "06:30" -> "0630". The portal expects zero-padded text, not a number
// (which would silently lose the leading zero).
function toBATime(hhmm) {
  if (!hhmm) return "";
  return hhmm.replace(":", "").padStart(4, "0");
}

function monthKeyOf(dateStr) { return dateStr.slice(0, 7); }

async function buildBARosterRows(stationId, dateStr) {
  const monthKey = monthKeyOf(dateStr);
  const [y, m, d] = dateStr.split("-").map(Number);

  const [roster, station] = await Promise.all([
    rosterRepo.findRosterByStationAndMonth(stationId, monthKey),
    rosterRepo.findStationById(stationId),
  ]);
  if (!roster) {
    throw ApiError.notFound(`No roster exists for ${monthKey} yet — generate or create it first.`);
  }

  const staff = await rosterRepo.getRosterGrid(stationId, roster.id);
  const rows = [];

  for (const s of staff) {
    const todayShift = s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr);
    if (!todayShift) continue;
    const def = todayShift.shiftDef;
    if (def.type !== "duty" && def.type !== "night") continue; // BA roster = who's actually reporting for duty
    if (!def.startTime || !def.endTime) continue; // shift types with no real time can't produce a valid row

    const [sh, sm] = def.startTime.split(":").map(Number);
    const [eh, em] = def.endTime.split(":").map(Number);
    const overnight = (eh * 60 + em) < (sh * 60 + sm); // e.g. Night: 21:00 -> 07:00 crosses midnight
    const endDateObj = new Date(Date.UTC(y, m - 1, d + (overnight ? 1 : 0)));

    const nameParts = s.fullName.split("(")[0].trim().split(" ");
    rows.push([
      s.employeeId || "",
      nameParts[0] || "",
      nameParts.slice(1).join(" ") || "",
      s.email || "",
      s.designation || "",
      "M&E",
      station?.iataCode || "",
      d, m, y,
      toBATime(def.startTime), toBATime(def.endTime), def.name.toUpperCase(),
      endDateObj.getUTCDate(), endDateObj.getUTCMonth() + 1, endDateObj.getUTCFullYear(),
    ]);
  }

  return rows;
}

async function generateBARosterExcel(stationId, dateStr) {
  const rows = await buildBARosterRows(stationId, dateStr);
  if (!rows.length) throw ApiError.badRequest("No staff are on duty that day — nothing to export");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.columns = COLUMN_WIDTHS.map(width => ({ width }));

  const headerRow = ws.addRow(BA_EXPORT_HEADER);
  headerRow.height = 59.25;
  headerRow.eachCell((cell, colNum) => {
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF002060" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFED7D31" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: WRAP_COLUMNS.has(colNum) };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });

  rows.forEach(r => {
    const row = ws.addRow(r);
    row.eachCell(cell => { cell.font = { name: "Calibri", size: 11, bold: false }; });
  });

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, rowCount: rows.length, filename: `BA_Roster_${dateStr}.xlsx` };
}

module.exports = { buildBARosterRows, generateBARosterExcel };
