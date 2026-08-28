const rosterRepo = require("../repositories/rosterRepository");
const complianceService = require("./complianceService");
const leaveService = require("./leaveService");
const ApiError = require("../utils/ApiError");

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
// already does, not alphabetically by name.
const CATEGORY_ORDER = ["B1", "B2", "CM", "NCS", "STO"];
function byCategoryThenName(staff) {
  return [...staff].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category || "NCS");
    const cb = CATEGORY_ORDER.indexOf(b.category || "NCS");
    if (ca !== cb) return ca - cb;
    return a.fullName.localeCompare(b.fullName);
  });
}

// ── Roster grid ───────────────────────────────────────────────────────────

// Shapes the roster grid into { header: string[], rows: string[][] } —
// identical structure regardless of whether the caller wants it as Excel,
// PDF, or CSV. This mirrors buildRosterSheetData from the original
// prototype, now backed by real per-staff shift assignment records.
async function getRosterReportData(stationId, monthKey) {
  const roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  if (!roster) throw ApiError.notFound(`No roster exists yet for ${monthKey}`);

  const staff = byCategoryThenName(await rosterRepo.getRosterGrid(stationId, roster.id));
  const nDays = daysInMonth(monthKey);
  const dayLabels = Array.from({ length: nDays }, (_, i) => dateLabel(monthKey, i + 1));

  // Employee ID leads the row so a re-import (see rosterImportService) can
  // match staff reliably even if two people share a similar name — name
  // alone is the fallback, not the primary key.
  const header = ["Employee ID", "Name", "Category", "Designation", ...dayLabels];
  const rows = staff.map(s => {
    const byDate = {};
    for (const sa of s.shiftAssignments) {
      const key = new Date(sa.shiftDate).toISOString().slice(0, 10);
      byDate[key] = sa.shiftDef.code;
    }
    return [s.employeeId || "", s.fullName, s.category || "", s.designation || "", ...dayLabels.map(d => byDate[d] || "O")];
  });

  return { header, rows, meta: { stationId, monthKey, isPublished: roster.isPublished, staffCount: staff.length } };
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

module.exports = { daysInMonth, dateLabel, getRosterReportData, getComplianceReportData, getLeaveReportData };
