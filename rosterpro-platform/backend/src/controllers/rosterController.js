const rosterService = require("../services/rosterService");
const rosterGenerationService = require("../services/rosterGenerationService");
const rosterImportService = require("../services/rosterImportService");
const shiftDefinitionService = require("../services/shiftDefinitionService");
const rosterPlanningService = require("../services/rosterPlanningService");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

function sendXlsx(res, buffer, filename) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

const getGrid = asyncHandler(async (req, res) => {
  const { stationId, monthKey } = req.query;
  const result = await rosterService.getRosterGrid(stationId, monthKey, req.user);
  res.json(result);
});

const upsertShift = asyncHandler(async (req, res) => {
  const { stationId, monthKey } = req.query;
  const result = await rosterService.upsertShift({ stationId, monthKey, ...req.body }, req.user, req);
  res.json(result);
});

const bulkUpsertShifts = asyncHandler(async (req, res) => {
  const { stationId, monthKey } = req.query;
  const result = await rosterService.bulkUpsertShifts({ stationId, monthKey, ...req.body }, req.user, req);
  res.json(result);
});

const publish = asyncHandler(async (req, res) => {
  const result = await rosterService.publishRoster(req.body.rosterId, req.user, req);
  res.json(result);
});

const unpublish = asyncHandler(async (req, res) => {
  const result = await rosterService.unpublishRoster(req.body.rosterId, req.body.reason, req.user, req);
  res.json(result);
});

const shiftDefinitions = asyncHandler(async (req, res) => {
  const result = await rosterService.listShiftDefinitions(req.user.airlineId);
  res.json(result);
});

const generate = asyncHandler(async (req, res) => {
  const { stationId, monthKey, preview, continueFromPrevious, usePatterns, applyLeave, aogBuffer } = req.body;
  const result = await rosterGenerationService.generateRoster(stationId, monthKey, req.user, req, { preview, continueFromPrevious, usePatterns, applyLeave, aogBuffer });
  res.json(result);
});

const archive = asyncHandler(async (req, res) => {
  const result = await rosterService.listRostersForStation(req.query.stationId);
  res.json(result);
});

const importRoster = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest("No file uploaded");
  const { stationId, monthKey } = req.query;
  const result = await rosterImportService.importRoster(stationId, monthKey, req.file.buffer, req.user, req);
  res.json(result);
});

const shiftDefinitionsTemplate = asyncHandler(async (req, res) => {
  const buffer = await shiftDefinitionService.generateTemplate();
  sendXlsx(res, buffer, "Shift_Definitions_Template.xlsx");
});

const shiftDefinitionsExport = asyncHandler(async (req, res) => {
  const buffer = await shiftDefinitionService.exportShiftDefinitions(req.user.airlineId);
  sendXlsx(res, buffer, "Shift_Definitions.xlsx");
});

const importShiftDefinitions = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest("No file uploaded");
  const result = await shiftDefinitionService.importShiftDefinitions(req.file.buffer, req.user, req);
  res.json(result);
});

// ─── Shift Definitions single-row CRUD ───────────────────────────────────────
const upsertShiftDefinition = asyncHandler(async (req, res) => {
  const result = await rosterPlanningService.upsertShiftDefinition(req.body, req.user, req);
  res.json(result);
});
const deactivateShiftDefinition = asyncHandler(async (req, res) => {
  const result = await rosterPlanningService.deactivateShiftDefinition(req.params.id, req.user, req);
  res.json(result);
});

// ─── Shift Patterns ───────────────────────────────────────────────────────────
const listPatterns = asyncHandler(async (req, res) => {
  const result = await rosterPlanningService.listPatterns(req.query.stationId);
  res.json(result);
});
const upsertPattern = asyncHandler(async (req, res) => {
  const result = await rosterPlanningService.upsertPattern(req.body, req.user, req);
  res.json(result);
});
const deletePattern = asyncHandler(async (req, res) => {
  const result = await rosterPlanningService.deletePattern(req.params.id, req.user, req);
  res.json(result);
});

// ─── Staff Allocation ─────────────────────────────────────────────────────────
const listAllocations = asyncHandler(async (req, res) => {
  const result = await rosterPlanningService.listAllocations(req.query.stationId);
  res.json(result);
});
const upsertAllocation = asyncHandler(async (req, res) => {
  const result = await rosterPlanningService.upsertAllocation(req.body, req.user, req);
  res.json(result);
});

// ─── Workload Items ───────────────────────────────────────────────────────────
const listWorkloadItems = asyncHandler(async (req, res) => {
  const result = await rosterPlanningService.listWorkloadItems(req.query.stationId);
  res.json(result);
});
const upsertWorkloadItem = asyncHandler(async (req, res) => {
  const result = await rosterPlanningService.upsertWorkloadItem(req.body, req.user, req);
  res.json(result);
});
const deleteWorkloadItem = asyncHandler(async (req, res) => {
  const result = await rosterPlanningService.deleteWorkloadItem(req.params.id, req.user, req);
  res.json(result);
});

// ─── Manpower Plan ────────────────────────────────────────────────────────────
const manpowerPlan = asyncHandler(async (req, res) => {
  const { stationId, monthKey, aogBuffer } = req.query;
  const result = await rosterPlanningService.getManpowerPlan(stationId, monthKey, aogBuffer !== undefined ? Number(aogBuffer) : undefined);
  res.json(result);
});

module.exports = {
  getGrid, upsertShift, bulkUpsertShifts, publish, unpublish, shiftDefinitions, generate, archive, importRoster,
  shiftDefinitionsTemplate, shiftDefinitionsExport, importShiftDefinitions,
  upsertShiftDefinition, deactivateShiftDefinition,
  listPatterns, upsertPattern, deletePattern,
  listAllocations, upsertAllocation,
  listWorkloadItems, upsertWorkloadItem, deleteWorkloadItem,
  manpowerPlan,
};
