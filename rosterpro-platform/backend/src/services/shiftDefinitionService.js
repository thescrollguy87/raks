const ExcelJS = require("exceljs");
const rosterRepo = require("../repositories/rosterRepository");
const auditTrail = require("../utils/auditTrail");
const { buildStyledSheet } = require("../utils/xlsxBuilder");
const { findHeaderRowIndex, parseExcelTimeCell } = require("../utils/xlsxParser");
const ApiError = require("../utils/ApiError");
const { resolveAirlineId } = require("../utils/stationScope");

const HEADER = ["Code", "Name", "Start Time (HH:MM)", "End Time (HH:MM)", "Break (min)", "Type (duty/night/off/leave/other)"];
const VALID_TYPES = new Set(["duty", "night", "off", "leave", "other"]);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Shift definitions are per-airline reference data, not per-station (see
// ShiftDefinition in schema.prisma) — this import/export pair is the one
// exception to "everything in this tab is scoped to the current station"
// for that reason, not by oversight: they're scoped one level up, to
// req.user.airlineId, instead.

function generateTemplate() {
  const legend = "Fill in one row per shift code. Leave Start/End Time blank for non-duty codes (e.g. Off, Leave) — both must be set together, or both left blank. Break is in minutes.";
  const exampleRows = [
    ["M", "Morning", "06:30", "14:00", 30, "duty"],
    ["O", "Off / Rest", "", "", 0, "off"],
  ];
  return buildStyledSheet("Shift Definitions Template", HEADER, exampleRows, { legend });
}

async function exportShiftDefinitions(actor, stationId) {
  const defs = await rosterRepo.findAllShiftDefs(await resolveAirlineId(actor, stationId));
  const rows = defs.map(d => [d.code, d.name, d.startTime || "", d.endTime || "", d.breakMin, d.type]);
  return buildStyledSheet("Shift Definitions", ["Code", "Name", "Start Time", "End Time", "Break (min)", "Type"], rows);
}

async function importShiftDefinitions(buffer, actor, req, stationId) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw ApiError.badRequest("Couldn't read that file — expected a .xlsx file");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw ApiError.badRequest("The file has no worksheet");

  const headerRowIndex = findHeaderRowIndex(ws, "Code");
  if (!headerRowIndex) {
    throw ApiError.badRequest("That file doesn't look like a shift definitions import — expected columns: Code, Name, Start Time, End Time, Break (min), Type");
  }

  const rows = [];
  const errors = [];
  const seenCodes = new Set();

  for (let r = headerRowIndex + 1; r <= ws.rowCount; r++) {
    const raw = ws.getRow(r).values.slice(1);
    if (!raw.length || !raw.some(v => v !== undefined && v !== null && String(v).trim() !== "")) continue; // blank row

    const code = raw[0] ? String(raw[0]).trim().toUpperCase() : "";
    const name = raw[1] ? String(raw[1]).trim() : "";
    const startTime = parseExcelTimeCell(raw[2]);
    const endTime = parseExcelTimeCell(raw[3]);
    const breakMinRaw = raw[4];
    const type = raw[5] ? String(raw[5]).trim().toLowerCase() : "";

    if (!code) { errors.push(`Row ${r}: Code is required`); continue; }
    if (seenCodes.has(code)) { errors.push(`Row ${r}: duplicate Code "${code}" in file`); continue; }
    seenCodes.add(code);

    if (!name) errors.push(`Row ${r} (${code}): Name is required`);
    if (!VALID_TYPES.has(type)) errors.push(`Row ${r} (${code}): Type must be one of duty, night, off, leave, other`);
    if (startTime && !TIME_RE.test(startTime)) errors.push(`Row ${r} (${code}): Start Time must be HH:MM (24-hour)`);
    if (endTime && !TIME_RE.test(endTime)) errors.push(`Row ${r} (${code}): End Time must be HH:MM (24-hour)`);
    if ((startTime && !endTime) || (!startTime && endTime)) {
      errors.push(`Row ${r} (${code}): Start Time and End Time must both be set, or both left blank`);
    }

    let breakMin = 0;
    if (breakMinRaw !== undefined && breakMinRaw !== null && String(breakMinRaw).trim() !== "") {
      breakMin = Number(breakMinRaw);
      if (!Number.isFinite(breakMin) || breakMin < 0) errors.push(`Row ${r} (${code}): Break (min) must be a non-negative number`);
    }

    rows.push({ code, name, startTime: startTime || null, endTime: endTime || null, breakMin, type });
  }

  if (!rows.length && !errors.length) throw ApiError.badRequest("No shift definition rows found in that file");
  // All-or-nothing: this is structural reference data every roster in the
  // airline depends on, so a bad row anywhere blocks the whole file rather
  // than silently applying the good rows and skipping the rest.
  if (errors.length) throw ApiError.badRequest("Fix the following and re-upload — nothing was imported.", errors);

  const airlineId = await resolveAirlineId(actor, stationId);
  const existing = await rosterRepo.findAllShiftDefsIncludingInactive(airlineId);
  const existingByCode = new Map(existing.map(d => [d.code, d]));
  let created = 0, updated = 0;

  for (const row of rows) {
    const before = existingByCode.get(row.code);
    const saved = await rosterRepo.upsertShiftDef(airlineId, row);
    if (before) {
      updated++;
      await auditTrail.recordUpdate(
        "ShiftDefinition", saved.id, null,
        { name: before.name, startTime: before.startTime, endTime: before.endTime, breakMin: before.breakMin, type: before.type },
        { name: saved.name, startTime: saved.startTime, endTime: saved.endTime, breakMin: saved.breakMin, type: saved.type },
        actor, req
      );
    } else {
      created++;
      await auditTrail.recordCreate("ShiftDefinition", saved.id, null, actor, req);
    }
  }

  await auditTrail.logActivity("Shift definitions imported", `${created} created, ${updated} updated`, null, actor, req);
  return { created, updated, total: rows.length };
}

module.exports = { generateTemplate, exportShiftDefinitions, importShiftDefinitions };
