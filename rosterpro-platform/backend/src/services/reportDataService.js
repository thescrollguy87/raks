const rosterRepo = require("../repositories/rosterRepository");
const stationRepo = require("../repositories/stationRepository");
const attendanceRepo = require("../repositories/attendanceRepository");
const complianceService = require("./complianceService");
const leaveService = require("./leaveService");
const attendanceService = require("./attendanceService");
const { FALLBACK_HEX } = require("../utils/colorTint");
const ApiError = require("../utils/ApiError");

// Real shift-code legend for the Monthly Roster's footer (Excel export/
// template) — the station's own configured codes/timings, never a
// hardcoded list that could drift from what's actually in Shift
// Definitions.
async function shiftLegendFor(stationId) {
  const station = await stationRepo.findStationAirlineId(stationId);
  if (!station) return [];
  return rosterRepo.findAllShiftDefs(station.airlineId);
}

// "Rakesh Patel" + category "B1" -> "RAKESH PATEL (B1)" — the Monthly
// Roster file's own convention for carrying category alongside the name
// (see utils/rosterFileFormat.js); purely informational, stripped back off
// by the importer before matching.
function nameWithCategory(fullName, category) {
  return category ? `${fullName.toUpperCase()} (${category})` : fullName.toUpperCase();
}

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function dateLabel(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toISOString().slice(0, 10);
}

// Same grouping order the Staff Registry and Roster grid UI both use —
// B1, B2, CM, NCS, STO — so an exported file reads the same way the app
// already does. Within a category, staff sort by rosterSortOrder (their
// row position in the most recently imported Monthly Roster file — see
// rosterImportService) so a round-trip export/re-import doesn't reshuffle
// anyone; alphabetical is only the fallback for staff no import has ever
// captured an order for.
const CATEGORY_ORDER = ["B1", "B2", "CM", "NCS", "STO"];
// Same section labels the Shift Roster grid and Staff Registry UI both use
// (see frontend CAT_LABELS in RosterPage.jsx/AutoRosterPage.jsx) — kept in
// sync deliberately, not imported across the frontend/backend boundary.
const CAT_LABELS = { B1: "B1 AME", B2: "B2 AME", CM: "Certifying Mechanic", NCS: "NCS / Tech", STO: "Stores" };
const WEEKDAY_2 = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthLabelFor(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
// "06:30" -> "0630" — the PDF roster's own compact convention (see
// reportRenderService.toRosterPdfBuffer), distinct from the colon'd
// "06:30–14:00" the on-screen legend/tooltips use.
function timeCompact(t) { return t ? t.replace(":", "") : ""; }
function byCategoryThenName(staff) {
  return [...staff].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category || "NCS");
    const cb = CATEGORY_ORDER.indexOf(b.category || "NCS");
    if (ca !== cb) return ca - cb;
    const oa = a.rosterSortOrder ?? Infinity;
    const ob = b.rosterSortOrder ?? Infinity;
    if (oa !== ob) return oa - ob;
    return a.fullName.localeCompare(b.fullName);
  });
}

// ── Roster grid ───────────────────────────────────────────────────────────

// Shapes the roster grid into { header: string[], rows: string[][], meta }
// matching the real Monthly Roster file this app imports/exports (see
// utils/rosterFileFormat.js) — S/N, Staff Name (with category noted in
// parentheses), Designation, Staff ID, then one column per day. Used
// as-is for PDF/CSV; toRosterExcelBuffer (reportRenderService) re-lays
// this same data out as the fuller title+date-row+weekday-row+legend
// Excel workbook.
async function getRosterReportData(stationId, monthKey) {
  const roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  if (!roster) throw ApiError.notFound(`No roster exists yet for ${monthKey}`);

  const staff = byCategoryThenName(await rosterRepo.getRosterGrid(stationId, roster.id));
  const nDays = daysInMonth(monthKey);
  const dayLabels = Array.from({ length: nDays }, (_, i) => dateLabel(monthKey, i + 1));
  const shiftDefs = await shiftLegendFor(stationId);

  // Staff ID trails, matching the real file's own column order — a
  // re-import (see rosterImportService) still matches by it first, name
  // (with the category suffix stripped) only as a fallback.
  const header = ["S/N", "Staff Name", "Designation", "Staff ID", ...dayLabels];
  const rows = staff.map((s, i) => {
    const byDate = {};
    for (const sa of s.shiftAssignments) {
      const key = new Date(sa.shiftDate).toISOString().slice(0, 10);
      byDate[key] = sa.shiftDef.code;
    }
    return [i + 1, nameWithCategory(s.fullName, s.category), s.designation || "", s.employeeId || "", ...dayLabels.map(d => byDate[d] || "O")];
  });

  return { header, rows, meta: { stationId, monthKey, isPublished: roster.isPublished, staffCount: staff.length, shiftDefs, title: `ROSTER — ${monthKey}` } };
}

// Blank starting point for the Monthly Roster import — same shape as
// getRosterReportData above (so it round-trips through Import exactly the
// same way), but every day defaults to "O" rather than reflecting real
// assignments, and it needs no roster to already exist for the month
// (unlike the export, which 404s until someone has opened that month's
// Shift Roster page at least once).
async function getRosterTemplateData(stationId, monthKey) {
  const staff = byCategoryThenName(await rosterRepo.getActiveStaffForGeneration(stationId));
  const nDays = daysInMonth(monthKey);
  const dayLabels = Array.from({ length: nDays }, (_, i) => dateLabel(monthKey, i + 1));
  const shiftDefs = await shiftLegendFor(stationId);

  const header = ["S/N", "Staff Name", "Designation", "Staff ID", ...dayLabels];
  const rows = staff.map((s, i) => [i + 1, nameWithCategory(s.fullName, s.category), s.designation || "", s.employeeId || "", ...dayLabels.map(() => "O")]);

  return { header, rows, meta: { stationId, monthKey, staffCount: staff.length, shiftDefs, title: `ROSTER TEMPLATE — ${monthKey}` } };
}

// Purpose-built shape for the Shift Roster PDF export (see
// reportRenderService.toRosterPdfBuffer) — category-grouped sections with
// per-cell shift code + real clock time + the tenant's own configured
// Shift Definition color, rather than the flat one-row-per-staff
// {header,rows} shape getRosterReportData produces for Excel/CSV (that
// shape collapses category into the name string and loses per-cell color
// entirely, neither of which the PDF's design can work from).
async function getRosterPdfData(stationId, monthKey) {
  const roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  if (!roster) throw ApiError.notFound(`No roster exists yet for ${monthKey}`);

  const station = await stationRepo.findStationWithAirline(stationId);
  const staff = byCategoryThenName(await rosterRepo.getRosterGrid(stationId, roster.id));
  const nDays = daysInMonth(monthKey);
  const dayLabels = Array.from({ length: nDays }, (_, i) => {
    const day = i + 1;
    const iso = dateLabel(monthKey, day);
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return { day, weekday: WEEKDAY_2[dow], iso };
  });

  const shiftDefs = await shiftLegendFor(stationId);
  const defByCode = new Map(shiftDefs.map(d => [d.code, d]));

  // Legend only lists codes actually used on this month's roster (plus the
  // implicit "O" default for a blank day) — never the airline's full,
  // possibly much longer, Shift Definitions list, which would crowd the
  // printed legend with codes nobody is on this month.
  const usedCodes = new Set(["O"]);
  for (const s of staff) for (const sa of s.shiftAssignments) usedCodes.add(sa.shiftDef.code);
  const legend = shiftDefs.filter(d => usedCodes.has(d.code)).sort((a, b) => a.sortOrder - b.sortOrder);
  if (!legend.some(d => d.code === "O")) {
    legend.push({ code: "O", name: "Off / Rest", color: FALLBACK_HEX, type: "off", startTime: null, endTime: null, sortOrder: 999 });
  }

  const categories = CATEGORY_ORDER.map(catCode => {
    const catStaff = staff.filter(s => (s.category || "NCS") === catCode);
    if (!catStaff.length) return null;
    return {
      code: catCode,
      label: CAT_LABELS[catCode] || catCode,
      staff: catStaff.map(s => {
        const byDate = new Map(s.shiftAssignments.map(sa => [new Date(sa.shiftDate).toISOString().slice(0, 10), sa]));
        return {
          fullName: s.fullName,
          days: dayLabels.map(({ iso }) => {
            const sa = byDate.get(iso);
            const code = sa?.shiftDef.code || "O";
            const def = defByCode.get(code) || null;
            // Same fallback chain the on-screen grid uses (RosterCell in
            // RosterPage.jsx): a per-assignment override first, then the
            // shift definition's own default — and OFF/LEAVE/DEPUTATION
            // codes naturally have neither, which is exactly what should
            // suppress the second time line (requirement, not a type check).
            const startTime = sa?.in1 || def?.startTime || null;
            const endTime = sa?.out1 || def?.endTime || null;
            const hasTime = !!(startTime && endTime);
            return {
              code,
              hasTime,
              timeLabel: hasTime ? `${timeCompact(startTime)}-${timeCompact(endTime)}` : "",
              color: def?.color || FALLBACK_HEX,
            };
          }),
        };
      }),
    };
  }).filter(Boolean);

  return {
    meta: {
      stationId, monthKey,
      stationName: station.name, iataCode: station.iataCode, airlineName: station.airline.name,
      monthLabel: monthLabelFor(monthKey),
      generatedAt: new Date(),
      isPublished: roster.isPublished,
    },
    legend,
    dayLabels,
    categories,
  };
}

// ── Compliance report ─────────────────────────────────────────────────────

// One row per qualification/license/training/authorization record, across
// every active staff member at the station — the "who's compliant, who
// isn't, and by when" report a quality manager actually needs to print.
async function getComplianceReportData(stationId, { userId } = {}) {
  const allStaff = await rosterRepo.getActiveStaffContacts(stationId);
  // Optional single-staff narrowing (e.g. the "Generate Report" button on
  // one person's Qualifications detail view) — a non-matching/missing
  // userId here would silently produce an empty report rather than fail,
  // so the caller is expected to have confirmed the id belongs to this
  // station first (the frontend only ever passes an id from staff already
  // loaded for this same station).
  const staff = userId ? allStaff.filter(s => s.id === userId) : allStaff;
  const header = ["Staff", "Type", "Item", "Expiry Date", "Status"];
  const rows = [];

  for (const s of staff) {
    const summary = await complianceService.getComplianceSummary(s.id);
    for (const q of summary.qualifications) {
      rows.push([s.fullName, "Qualification", q.qualCode, q.expiryDate?.toISOString().slice(0, 10) || "—", q.status]);
    }
    for (const l of summary.licenses) {
      rows.push([s.fullName, "License", `${l.category} (${l.licenseNo})`, l.expiryDate?.toISOString().slice(0, 10) || "—", l.status]);
    }
    for (const t of summary.trainings) {
      rows.push([s.fullName, "Training", t.courseName, t.validUntil?.toISOString().slice(0, 10) || "No expiry", t.status]);
    }
    for (const a of summary.authorizations) {
      rows.push([s.fullName, "Authorization", a.scope, a.expiryDate?.toISOString().slice(0, 10) || "No expiry", a.status]);
    }
  }

  // Most urgent first — EXPIRED, then EXPIRING, then VALID, alphabetical within each.
  const order = { EXPIRED: 0, EXPIRING: 1, VALID: 2 };
  rows.sort((a, b) => (order[a[4]] - order[b[4]]) || a[0].localeCompare(b[0]));

  return { header, rows, meta: { stationId, userId: userId || null, staffCount: staff.length, recordCount: rows.length } };
}

// ── Leave balance report ─────────────────────────────────────────────────────

async function getLeaveReportData(stationId, year) {
  const staff = await rosterRepo.getActiveStaffContacts(stationId);
  const types = ["ANNUAL", "SICK", "CASUAL", "MEDICAL", "LWP"];
  const header = ["Staff", ...types.flatMap(t => [`${t} Taken`, `${t} Remaining`])];

  const rows = await Promise.all(staff.map(async (s) => {
    const { balance } = await leaveService.getBalance(s.id, year);
    return [s.fullName, ...types.flatMap(t => [balance[t]?.taken ?? 0, balance[t]?.remaining ?? 0])];
  }));

  return { header, rows, meta: { stationId, year, staffCount: staff.length } };
}

// ── Geolocation attendance ─────────────────────────────────────────────────

function formatClockTime(dt) {
  if (!dt) return "";
  return new Date(dt).toISOString().slice(11, 16); // "HH:MM" in UTC — matches how shift startTime/endTime are stored
}

const STATUS_LABEL = {
  ON_TIME: "On Time", LATE: "Late", EARLY_OUT: "Early Out",
  MISSING: "Missing Punch", REGULARIZED: "Regularized", EXEMPT: "—",
};

// One row per staff-member-per-day (not per staff-member-per-month) — a
// register reads as a chronological log, matching how a real attendance
// register/muster roll is laid out, unlike the Roster export's one-row-
// per-staff/one-column-per-day grid.
async function getAttendanceRegisterData(stationId, monthKey) {
  const nDays = daysInMonth(monthKey);
  const from = new Date(`${dateLabel(monthKey, 1)}T00:00:00.000Z`);
  const to = new Date(`${dateLabel(monthKey, nDays)}T00:00:00.000Z`);

  const roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  const staffWithShifts = roster ? byCategoryThenName(await rosterRepo.getRosterGrid(stationId, roster.id)) : byCategoryThenName(await rosterRepo.getActiveStaffForGeneration(stationId));
  const attendanceRows = await attendanceRepo.listForRange(stationId, from, to);

  const attendanceByKey = new Map(attendanceRows.map(r => [`${r.userId}:${r.date.toISOString().slice(0, 10)}`, r]));
  const shiftByKey = new Map();
  for (const s of staffWithShifts) {
    for (const sa of s.shiftAssignments || []) {
      shiftByKey.set(`${s.id}:${new Date(sa.shiftDate).toISOString().slice(0, 10)}`, sa.shiftDef);
    }
  }

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const header = ["Date", "Staff", "Category", "Scheduled Shift", "Punch In", "Punch Out", "Status", "Regularization"];
  const rows = [];
  for (const s of staffWithShifts) {
    for (let day = 1; day <= nDays; day++) {
      const iso = dateLabel(monthKey, day);
      const key = `${s.id}:${iso}`;
      const shiftDef = shiftByKey.get(key) || null;
      const record = attendanceByKey.get(key) || null;
      const exempt = attendanceService.isExemptShiftType(shiftDef?.type);
      const isPast = new Date(`${iso}T00:00:00.000Z`) < today;

      let statusLabel;
      if (record) statusLabel = STATUS_LABEL[record.status] || record.status;
      else if (exempt) statusLabel = STATUS_LABEL.EXEMPT;
      else if (shiftDef && isPast) statusLabel = STATUS_LABEL.MISSING;
      else statusLabel = "";

      const latestReg = record?.regularizationRequests?.[0];
      const regularizationLabel = latestReg ? `${latestReg.status} (${latestReg.reason})` : "";

      rows.push([
        iso, s.fullName, s.category || "", shiftDef?.code || (exempt ? "" : "O"),
        formatClockTime(record?.punchInAt), formatClockTime(record?.punchOutAt),
        statusLabel, regularizationLabel,
      ]);
    }
  }

  return { header, rows, meta: { stationId, monthKey, staffCount: staffWithShifts.length, title: `ATTENDANCE REGISTER — ${monthKey}` } };
}

module.exports = {
  daysInMonth, dateLabel, getRosterReportData, getRosterTemplateData, getRosterPdfData, getComplianceReportData, getLeaveReportData,
  getAttendanceRegisterData,
};
