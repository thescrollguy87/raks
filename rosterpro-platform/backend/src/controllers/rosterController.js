const rosterService = require("../services/rosterService");
const rosterGenerationService = require("../services/rosterGenerationService");
const rosterImportService = require("../services/rosterImportService");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

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
  const result = await rosterService.listShiftDefinitions();
  res.json(result);
});

const generate = asyncHandler(async (req, res) => {
  const { stationId, monthKey, preview, continueFromPrevious } = req.body;
  const result = await rosterGenerationService.generateRoster(stationId, monthKey, req.user, req, { preview, continueFromPrevious });
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

module.exports = { getGrid, upsertShift, bulkUpsertShifts, publish, unpublish, shiftDefinitions, generate, archive, importRoster };
