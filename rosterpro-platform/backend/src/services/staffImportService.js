const ExcelJS = require("exceljs");
const userRepo = require("../repositories/userRepository");
const rosterRepo = require("../repositories/rosterRepository");
const auditTrail = require("../utils/auditTrail");
const { buildStyledSheet } = require("../utils/xlsxBuilder");
const { findHeaderRowIndex } = require("../utils/xlsxParser");
const ApiError = require("../utils/ApiError");

const CATEGORIES = ["B1", "B2", "CM", "NCS", "STO"]; // same values Staff Registry's own Category field uses
const TEMPLATE_HEADER = ["Staff No", "First Name", "Last Name", "Email", "Designation", "Category (B1/B2/CM/NCS/STO)", "Department", "Location (station IATA code, ICAO code, or name)"];
const EXPORT_HEADER = ["Staff No", "First Name", "Last Name", "Email", "Designation", "Category", "Department", "Location"];

function generateTemplate() {
  const legend = "Location accepts the station's IATA code (e.g. AMD), ICAO code (e.g. VAAH), or its full name (e.g. Ahmedabad) — must match the station currently selected in RosterPro; rows for any other station are skipped. Category must be one of B1, B2, CM, NCS, STO — the same values used in Staff Registry. Staff are matched by Staff No first, then by full name if no ID matches; unmatched rows are reported back rather than created (add new staff via Staff Registry first).";
  const exampleRows = [
    ["EMP1042", "Aisha", "Khan", "aisha.khan@airline.example", "B1 AME", "B1", "Line Maintenance", "Ahmedabad"],
  ];
  return buildStyledSheet("Employee Master Template", TEMPLATE_HEADER, exampleRows, { legend });
}

// A real, filled-in export of one station's active staff, in the exact
// layout importEmployeeMaster expects back — so export → edit → re-import
// round-trips (see StaffPage/ImportExportPage, which both call this).
async function exportEmployeeMaster(stationId) {
  const [staff, station] = await Promise.all([
    userRepo.findActiveByStation(stationId),
    rosterRepo.findStationById(stationId),
  ]);
  const rows = staff.map(s => {
    const parts = s.fullName.trim().split(/\s+/);
    return [
      s.employeeId || "", parts[0] || "", parts.slice(1).join(" "), s.email || "",
      s.designation || "", s.category || "", s.department || "", station?.name || "",
    ];
  });
  return buildStyledSheet("Employee Master", EXPORT_HEADER, rows);
}

// Reconciles an external HR/master-data export against RosterPro's existing
// staff at ONE station — never creates a new login (no password/roles in
// this file format) and never moves anyone to a different station (a row
// naming a different station is skipped, not honored, even for an
// airline-wide caller — reassigning stations is a deliberate admin action
// elsewhere, not a side effect of a data-sync upload). Matches by Staff No
// first, falling back to a case-insensitive full-name match, because the
// same person is known to carry different Staff IDs across source systems.
async function importEmployeeMaster(stationId, buffer, actor, req) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw ApiError.badRequest("Couldn't read that file — expected a .xlsx file");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw ApiError.badRequest("The file has no worksheet");

  const headerRowIndex = findHeaderRowIndex(ws, "Staff No");
  if (!headerRowIndex) {
    throw ApiError.badRequest("That file doesn't look like an Employee Master import — expected columns: Staff No, First Name, Last Name, Email, Designation, Category, Department, Location");
  }

  const [staff, station] = await Promise.all([
    userRepo.findActiveByStation(stationId),
    rosterRepo.findStationById(stationId),
  ]);
  const byEmployeeId = new Map(staff.filter(s => s.employeeId).map(s => [s.employeeId, s]));
  const byName = new Map(staff.map(s => [s.fullName.trim().toUpperCase(), s]));
  // Accepts IATA code, ICAO code, or the station's own name — whichever a
  // real source file happens to use — case-insensitive and trimmed.
  const stationTokens = [station?.name, station?.iataCode, station?.icaoCode]
    .filter(Boolean).map(t => t.toUpperCase());
  const expectedLocationFormats = [station?.iataCode, station?.icaoCode, station?.name].filter(Boolean).join(", ");

  let updated = 0;
  const notFound = [];
  const stationMismatch = [];
  const idKept = [];
  const rowErrors = [];
  const duplicates = [];
  const seenInFile = new Map();

  for (let r = headerRowIndex + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r).values.slice(1);
    if (!row.length || !row.some(v => v !== undefined && v !== null && String(v).trim() !== "")) continue; // blank row

    const staffNo = row[0] ? String(row[0]).trim() : "";
    const firstName = row[1] ? String(row[1]).trim() : "";
    const lastName = row[2] ? String(row[2]).trim() : "";
    const email = row[3] ? String(row[3]).trim().toLowerCase() : "";
    const designation = row[4] ? String(row[4]).trim() : "";
    const categoryRaw = row[5] ? String(row[5]).trim() : "";
    const department = row[6] ? String(row[6]).trim() : "";
    const location = row[7] ? String(row[7]).trim() : "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ");

    if (!fullName) continue; // nothing to match on

    const dupKey = staffNo || fullName.toUpperCase();
    if (seenInFile.has(dupKey)) {
      duplicates.push(`${fullName} (row ${r}, first seen row ${seenInFile.get(dupKey)})`);
      continue;
    }
    seenInFile.set(dupKey, r);

    if (location && stationTokens.length && !stationTokens.includes(location.toUpperCase())) {
      stationMismatch.push(
        `${fullName} (row ${r}): Location "${location}" doesn't match ${station?.name || "the currently selected station"} — expected one of: ${expectedLocationFormats}`
      );
      continue;
    }

    const category = categoryRaw ? categoryRaw.toUpperCase() : "";
    if (category && !CATEGORIES.includes(category)) {
      rowErrors.push(`${fullName} (row ${r}): Category "${categoryRaw}" is invalid — expected one of: ${CATEGORIES.join(", ")}`);
      continue;
    }

    const match = (staffNo && byEmployeeId.get(staffNo)) || byName.get(fullName.toUpperCase());
    if (!match) { notFound.push(fullName); continue; }

    const data = { fullName, updatedById: actor.sub };
    if (email) data.email = email;
    if (designation) data.designation = designation;
    if (category) data.category = category;
    if (department) data.department = department;
    // Never overwrite an existing Staff No with a different one from the
    // file — the real-world problem this import solves is the same person
    // carrying different IDs in different source systems, so a mismatch
    // here is far more likely to be a stale/wrong file value than a
    // correction, and blindly trusting it could scramble roster-import
    // matching for this person going forward.
    if (staffNo && !match.employeeId) data.employeeId = staffNo;
    else if (staffNo && match.employeeId && match.employeeId !== staffNo) idKept.push(`${fullName} (row ${r}): kept existing Staff No "${match.employeeId}", file had "${staffNo}"`);

    try {
      const before = { fullName: match.fullName, email: match.email, designation: match.designation, category: match.category, department: match.department };
      await userRepo.update(match.id, data);
      updated++;
      await auditTrail.recordUpdate("User", match.id, stationId, before, data, actor, req);
    } catch (err) {
      rowErrors.push(`${fullName} (row ${r}): ${err.code === "P2002" ? "email already used by another account" : "could not be updated"}`);
    }
  }

  if (updated) {
    await auditTrail.logActivity("Employee master imported", `${updated} staff updated at ${station?.name || stationId}`, stationId, actor, req);
  }

  return { updated, notFound: [...new Set(notFound)], stationMismatch, idKept, rowErrors, duplicates };
}

module.exports = { generateTemplate, exportEmployeeMaster, importEmployeeMaster };
