const rosterRepo = require("../repositories/rosterRepository");
const stationRepo = require("../repositories/stationRepository");
const complianceService = require("./complianceService");
const leaveService = require("./leaveService");
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

// ── Compliance report ─────────────────────────────────────────────────────

// One row per qualification/license/training/authorization record, across
// every active staff member at the station — the "who's compliant, who
// isn't, and by when" report a quality manager actually needs to print.
async function getComplianceReportData(stationId) {
  const staff = await rosterRepo.getActiveStaffContacts(stationId);
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
  }

  // Most urgent first — EXPIRED, then EXPIRING, then VALID, alphabetical within each.
  const order = { EXPIRED: 0, EXPIRING: 1, VALID: 2 };
  rows.sort((a, b) => (order[a[4]] - order[b[4]]) || a[0].localeCompare(b[0]));

  return { header, rows, meta: { stationId, staffCount: staff.length, recordCount: rows.length } };
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

module.exports = { daysInMonth, dateLabel, getRosterReportData, getRosterTemplateData, getComplianceReportData, getLeaveReportData };
