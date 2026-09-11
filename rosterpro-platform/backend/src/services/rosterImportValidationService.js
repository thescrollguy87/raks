const ExcelJS = require("exceljs");
const prisma = require("../config/prisma");
const rosterRepo = require("../repositories/rosterRepository");
const rosterService = require("./rosterService");
const rosterVersionService = require("./rosterVersionService");
const leaveRepo = require("../repositories/leaveRepository");
const { buildLeaveByUserDay } = require("./rosterGenerationService");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const { resolveAirlineId, assertOwnStation } = require("../utils/stationScope");
const { LEADING_COLUMNS, LEGEND_SENTINEL, stripNameSuffix, findHeaderRowIndex, findDateRowIndex } = require("../utils/rosterFileFormat");

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function dateAt(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toISOString().slice(0, 10);
}
// Real Date object form, for the one call site (the leave-range query)
// that needs an actual Date rather than the "YYYY-MM-DD" string every
// other use of dateAt() in this file produces (matching
// rosterImportService.js's own convention for shiftDate strings).
function dateObjAt(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

// Same cell/row decoding rosterImportService.js uses — kept identical
// (duplicated, not imported from there) since that module also imports
// rosterService directly and this one needs to stay independent of it to
// avoid a circular require; both stay in sync with utils/rosterFileFormat.js.
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

// Step 2-4 of the import wizard: read the file, recognize its structure,
// and validate every row/cell WITHOUT writing anything to the roster or
// shift assignment tables — only an ImportJob + its ImportError rows are
// persisted, so "Validate" is always safe to run repeatedly. `Import N
// Records` (commitRosterImport, below) is the only function in this file
// that touches ShiftAssignment.
async function validateRosterImport(stationId, monthKey, buffer, fileName, actor, req) {
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

  const nDays = daysInMonth(monthKey);
  const dateRow = rows[dateRowIndex];
  const fileDayCount = dateRow.slice(LEADING_COLUMNS).filter(v => v instanceof Date).length;
  if (fileDayCount !== nDays) {
    throw ApiError.badRequest(`File has ${fileDayCount} day columns but ${monthKey} has ${nDays} days — import into the same month the file is for.`);
  }

  const roster = await rosterService.getOrCreateRoster(stationId, monthKey, actor);
  const airlineId = await resolveAirlineId(actor, stationId);
  const staff = await rosterRepo.getActiveStaffForGeneration(stationId);
  const [shiftDefs, currentGrid, leaves] = await Promise.all([
    rosterRepo.findAllShiftDefs(airlineId),
    rosterRepo.getRosterGrid(stationId, roster.id),
    leaveRepo.approvedLeaveForStaffInRange(staff.map(s => s.id), dateObjAt(monthKey, 1), dateObjAt(monthKey, nDays)),
  ]);
  const validCodes = new Set(shiftDefs.map(d => d.code));
  const byEmployeeId = new Map(staff.filter(s => s.employeeId).map(s => [s.employeeId, s]));
  const byName = new Map(staff.map(s => [stripNameSuffix(s.fullName).toUpperCase(), s]));
  const leaveByUserDay = buildLeaveByUserDay(leaves, monthKey, nDays);

  // Current live state, shaped for the create/update/unchanged comparison
  // below — undefined (not present in the map) means "no assignment ever
  // saved for this staff/day", distinct from an explicit "O".
  const currentByUserDay = new Map();
  for (const s of currentGrid) {
    const byDay = new Map();
    for (const sa of s.shiftAssignments) {
      const d = new Date(sa.shiftDate);
      const day = d.getUTCDate();
      byDay.set(day, sa.shiftDef.code);
    }
    currentByUserDay.set(s.id, byDay);
  }

  const errors = []; // { rowNumber, field, value, message, suggestion, severity }
  const assignments = [];
  const sortOrders = [];
  const seenInFile = new Map();
  let nextOrder = 0;
  let createCount = 0, updateCount = 0, unchangedCount = 0;
  let dataRows = 0;

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const firstCell = row[0];
    if (typeof firstCell === "string" && firstCell.trim().toLowerCase() === LEGEND_SENTINEL) break;
    const rawName = row[1];
    if (!rawName || !String(rawName).trim()) continue; // blank spacer row
    dataRows++;

    const fileRowNum = i + 1;
    const employeeId = row[3] ? String(row[3]).trim() : "";
    const name = stripNameSuffix(rawName);
    if (!name) continue;

    const dupKey = employeeId || name.toUpperCase();
    if (seenInFile.has(dupKey)) {
      errors.push({
        rowNumber: fileRowNum, field: "Staff Name", value: name,
        message: `Duplicate entry — already seen at row ${seenInFile.get(dupKey)}`,
        suggestion: "Remove the duplicate row; the later occurrence will overwrite the earlier one on import",
        severity: "WARNING",
      });
    } else {
      seenInFile.set(dupKey, fileRowNum);
    }

    const match = (employeeId && byEmployeeId.get(employeeId)) || byName.get(name.toUpperCase());
    if (!match) {
      errors.push({
        rowNumber: fileRowNum, field: "Staff Name", value: name,
        message: `Unknown staff — no active staff member matches ${employeeId ? `Staff ID "${employeeId}"` : `name "${name}"`}`,
        suggestion: "Add this person via Staff Registry first, or fix the Staff ID/name in the file",
        severity: "ERROR",
      });
      continue;
    }

    const fileCodeByDay = new Map();
    for (let day = 1; day <= nDays; day++) {
      const cell = row[LEADING_COLUMNS + day - 1];
      const raw = cell ? String(cell).trim() : "";
      const code = raw ? raw.toUpperCase() : "O";
      if (raw && !validCodes.has(code)) {
        errors.push({
          rowNumber: fileRowNum, field: `Day ${day}`, value: raw,
          message: `Unrecognized shift code "${raw}"`,
          suggestion: "Check Shift Definitions for the valid code list",
          severity: "ERROR",
        });
        continue; // this one cell is skipped; the rest of the row still processes
      }
      fileCodeByDay.set(day, code);
      if (code !== "O" && code !== "L" && leaveByUserDay[match.id]?.has(day)) {
        errors.push({
          rowNumber: fileRowNum, field: `Day ${day}`, value: code,
          message: `${name} is on approved leave this date`,
          suggestion: "Confirm this is intentional, or correct the shift code",
          severity: "WARNING",
        });
      }
    }

    const currentDays = currentByUserDay.get(match.id) || new Map();
    let rowChanged = false;
    const hadAnyPrior = currentDays.size > 0;
    for (const [day, code] of fileCodeByDay) {
      if (currentDays.get(day) !== code) rowChanged = true;
      assignments.push({ userId: match.id, shiftDate: dateAt(monthKey, day), shiftCode: code });
    }
    if (!hadAnyPrior) createCount++;
    else if (rowChanged) updateCount++;
    else unchangedCount++;

    sortOrders.push({ userId: match.id, order: nextOrder++ });
  }

  const errorRows = errors.filter(e => e.severity === "ERROR").length;
  const warningRows = errors.filter(e => e.severity === "WARNING").length;
  const validRows = dataRows - new Set(errors.filter(e => e.severity === "ERROR").map(e => e.rowNumber)).size;

  const job = await prisma.importJob.create({
    data: {
      stationId, importType: "roster", monthKey, fileName,
      status: "VALIDATED",
      totalRows: dataRows, validRows, warningRows, errorRows,
      createdCount: createCount, updatedCount: updateCount, unchangedCount: unchangedCount,
      validatedPayload: { assignments, sortOrders },
      createdById: actor?.sub || null,
      errors: { create: errors },
    },
    include: { errors: true },
  });

  await auditTrail.logActivity(
    "Roster Excel import validated",
    `${stationId} — ${monthKey}: ${fileName} — ${dataRows} rows, ${errorRows} error(s), ${warningRows} warning(s)`,
    stationId, actor, req
  );

  return {
    jobId: job.id,
    summary: {
      totalRows: dataRows, validRows, warningRows, errorRows,
      createCount, updateCount, unchangedCount,
    },
    recognizedColumns: `S/N, Staff Name, Designation, Staff ID, ${nDays} day column${nDays === 1 ? "" : "s"} (1–${nDays})`,
    errors: job.errors.map(e => ({ rowNumber: e.rowNumber, field: e.field, value: e.value, message: e.message, suggestion: e.suggestion, severity: e.severity })),
  };
}

async function getImportJob(jobId, actor) {
  const job = await prisma.importJob.findUnique({ where: { id: jobId }, include: { errors: true } });
  if (!job) throw ApiError.notFound("Import job not found");
  await assertOwnStation(actor, job.stationId);
  return job;
}

// Step 5: the same Row/Field/Value/Error/Suggested Fix table the summary
// screen shows, as a downloadable workbook — regenerated from the
// persisted ImportError rows, not the original file (which the caller may
// no longer have open).
async function getImportErrorsWorkbook(jobId, actor) {
  const job = await getImportJob(jobId, actor);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Import Errors");
  ws.columns = [
    { header: "Row", key: "row", width: 8 },
    { header: "Field", key: "field", width: 14 },
    { header: "Value", key: "value", width: 18 },
    { header: "Error", key: "error", width: 50 },
    { header: "Suggested Fix", key: "fix", width: 45 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const e of job.errors) {
    ws.addRow({ row: e.rowNumber, field: e.field || "", value: e.value || "", error: `[${e.severity}] ${e.message}`, fix: e.suggestion || "" });
  }
  return wb.xlsx.writeBuffer();
}

// Step 6-8: commit exactly what was validated (the frozen
// validatedPayload — never re-reads or re-parses the file), inside one
// version-checkpointed transaction. If ANYTHING in the write fails, the
// existing bulkUpsertAssignments transaction rolls back as a whole — this
// function never leaves ShiftAssignment rows partially updated.
async function commitRosterImport(jobId, actor, req) {
  const job = await getImportJob(jobId, actor);
  if (job.status === "COMMITTED") throw ApiError.conflict("This import has already been committed");
  if (job.status !== "VALIDATED") throw ApiError.conflict(`Import job is in status ${job.status}, expected VALIDATED`);

  const { assignments, sortOrders } = job.validatedPayload || { assignments: [], sortOrders: [] };
  const roster = await rosterService.getOrCreateRoster(job.stationId, job.monthKey, actor);
  if (roster.isPublished) throw ApiError.forbidden("Roster is published — unpublish before importing");

  // Checkpoint whatever the roster held immediately before this import
  // overwrites it — same non-destructive-history guarantee as every other
  // version-creating action.
  await rosterVersionService.createVersion(roster.id, `Before Excel roster import (${job.fileName})`, actor, req);

  if (sortOrders?.length) await rosterRepo.updateRosterSortOrders(sortOrders);
  if (assignments?.length) {
    await rosterService.bulkUpsertShifts({ stationId: job.stationId, monthKey: job.monthKey, assignments }, actor, req);
  }

  const updated = await prisma.importJob.update({
    where: { id: job.id },
    data: { status: "COMMITTED", committedAt: new Date() },
  });

  await auditTrail.recordCreate("ImportJob", job.id, job.stationId, actor, req);
  await auditTrail.logActivity(
    "Roster Excel import completed",
    `${job.stationId} — ${job.monthKey}: ${job.fileName} by ${actor?.name || "System"} — ${job.createdCount} created, ${job.updatedCount} updated, ${job.unchangedCount} unchanged`,
    job.stationId, actor, req
  );

  return {
    jobId: job.id, status: updated.status,
    createdCount: job.createdCount, updatedCount: job.updatedCount, unchangedCount: job.unchangedCount,
    failedCount: job.errorRows,
  };
}

module.exports = { validateRosterImport, getImportJob, getImportErrorsWorkbook, commitRosterImport };
