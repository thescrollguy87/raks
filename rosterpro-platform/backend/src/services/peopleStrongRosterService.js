const ExcelJS = require("exceljs");
const rosterRepo = require("../repositories/rosterRepository");
const ApiError = require("../utils/ApiError");
const { PEOPLESTRONG_SHIFT_LIST } = require("../data/peopleStrongShiftList");

// Confirmed directly against the real template + the user's own already-
// submitted file: these 7 codes are the only ones this app's roster can
// produce that map cleanly onto a PeopleStrong Shift_List entry. L/TRG/D
// (ordinary leave / training / deputation) all collapse onto the same "19
// Shift" admin slot per explicit instruction — PeopleStrong has no concept
// of "why" someone wasn't on a real line shift, just that they weren't.
const SHIFT_LABEL_BY_CODE = {
  M: "M&E 6/2 Blr/Bom M (0630-1400)",
  A: "M&E 6/2 Blr/Bom A (1330-2130)",
  N: "M&E 6/2 Blr/Bom N (2100-0700)",
  O: "Weekly Off",
  L: "19  Shift (09:00 - 17:30)",
  TRG: "19  Shift (09:00 - 17:30)",
  D: "19  Shift (09:00 - 17:30)",
};

// Same B1/B2/CM/NCS/STO grouping order the Staff Registry and Roster grid
// UI use. Unlike the BA Roster export, Stores (STO) staff ARE included
// here — biometric attendance applies to everyone physically at the
// station, not just the airside-tested population the BA export covers.
const CATEGORY_ORDER = ["B1", "B2", "CM", "NCS", "STO"];
function byCategoryThenName(staff) {
  return [...staff].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category || "NCS");
    const cb = CATEGORY_ORDER.indexOf(b.category || "NCS");
    if (ca !== cb) return ca - cb;
    return a.fullName.localeCompare(b.fullName);
  });
}

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
// "2026-11", 5 -> "05/11/2026" — the template's own DD/MM/YYYY text format
// (plain strings, not real Excel date cells — confirmed directly against
// both the blank template and the user's submitted file).
function dateLabel(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return `${String(day).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}
function isoDate(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toISOString().slice(0, 10);
}

// Resolves every staff member's whole month in one pass — shared by both
// the actual Excel export and the lightweight warnings-only preview the
// frontend checks before/alongside downloading, so the two can never
// disagree about what the file will actually contain.
async function buildPeopleStrongRosterData(stationId, monthKey) {
  const roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  if (!roster) {
    throw ApiError.notFound(`No roster exists for ${monthKey} yet — generate or create it first.`);
  }

  const nDays = daysInMonth(monthKey);
  const dayLabels = Array.from({ length: nDays }, (_, i) => dateLabel(monthKey, i + 1));
  const staffRows = byCategoryThenName(await rosterRepo.getRosterGrid(stationId, roster.id));

  const warnings = [];
  const staff = staffRows.map(s => {
    const byDate = new Map(s.shiftAssignments.map(sa => [new Date(sa.shiftDate).toISOString().slice(0, 10), sa]));
    const cells = [];
    for (let day = 1; day <= nDays; day++) {
      const sa = byDate.get(isoDate(monthKey, day));
      const code = sa?.shiftDef.code || "O"; // no assignment that day = Off, same convention every other export in this app uses
      const label = SHIFT_LABEL_BY_CODE[code];
      if (label === undefined) {
        warnings.push({ employeeId: s.employeeId || "", fullName: s.fullName, date: dateLabel(monthKey, day), code });
        cells.push("");
      } else {
        cells.push(label);
      }
    }
    return { employeeId: s.employeeId || "", fullName: s.fullName, cells };
  });

  return { staff, dayLabels, warnings };
}

// Lightweight check — same resolution as the real export, but returns only
// the warnings/counts a caller needs to decide whether to proceed, without
// building a workbook. Used by the frontend's preflight check right before
// (or alongside) triggering the actual download.
async function getPeopleStrongRosterWarnings(stationId, monthKey) {
  const { staff, warnings } = await buildPeopleStrongRosterData(stationId, monthKey);
  return { warnings, staffCount: staff.length };
}

// A-Z, AA-AZ, ... — plain base-26 column letters, no library needed for
// just building one range reference string.
function columnLetter(n) {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function generatePeopleStrongRosterExcel(stationId, monthKey) {
  const { staff, dayLabels, warnings } = await buildPeopleStrongRosterData(stationId, monthKey);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Template_EmployeeRosterSchedule");
  ws.addRow(["Employee Code", "Employee Name", ...dayLabels]);
  for (const s of staff) ws.addRow([s.employeeId, s.fullName, ...s.cells]);

  ws.getColumn(1).width = 17;
  ws.getColumn(2).width = 32;
  for (let i = 3; i <= dayLabels.length + 2; i++) ws.getColumn(i).width = 13;

  const shiftWs = wb.addWorksheet("Shift_List");
  for (const label of PEOPLESTRONG_SHIFT_LIST) shiftWs.addRow([label]);
  shiftWs.getColumn(1).width = 36;

  // Matches the real template's own C2:<lastCol><lastRow> dropdown exactly
  // (day columns, every staff row) — sourced from the Shift_List sheet
  // directly rather than a workbook-level defined name, which renders
  // identically in Excel without the extra bookkeeping.
  if (staff.length && dayLabels.length) {
    const lastCol = columnLetter(dayLabels.length + 2);
    const lastRow = staff.length + 1;
    ws.dataValidations.add(`C2:${lastCol}${lastRow}`, {
      type: "list", allowBlank: true, formulae: [`Shift_List!$A$1:$A$${PEOPLESTRONG_SHIFT_LIST.length}`],
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, warnings, staffCount: staff.length, filename: `PeopleStrong_Roster_${monthKey}.xlsx` };
}

module.exports = { buildPeopleStrongRosterData, getPeopleStrongRosterWarnings, generatePeopleStrongRosterExcel, SHIFT_LABEL_BY_CODE };
