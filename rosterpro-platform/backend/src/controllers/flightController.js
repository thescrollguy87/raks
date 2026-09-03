const svc = require("../services/flightService");
const flightImportService = require("../services/flightImportService");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { resolveAirlineId } = require("../utils/stationScope");

const create = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createFlight(req.body, req.user, req));
});
const updateStatus = asyncHandler(async (req, res) => {
  res.json(await svc.updateFlightStatus(req.params.id, req.body, req.user, req));
});
const recordDelay = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.recordDelay(req.body, req.user, req));
});
const listForStation = asyncHandler(async (req, res) => {
  res.json(await svc.listForStation(req.params.stationId, req.query.from, req.query.to));
});
const listDelaysForStation = asyncHandler(async (req, res) => {
  res.json(await svc.listDelaysForStation(req.params.stationId, req.query.from, req.query.to));
});

const importTemplate = asyncHandler(async (req, res) => {
  const buffer = await flightImportService.generateTemplate();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Flight_Schedule_Template.xlsx"`);
  res.send(buffer);
});

const importFlightSchedule = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest("No file uploaded");
  const { stationId, monthKey } = req.query;
  const airlineId = await resolveAirlineId(req.user, stationId);
  const result = await flightImportService.importFlightSchedule(stationId, monthKey, airlineId, req.file.buffer, req.user, req);
  res.json(result);
});

module.exports = { create, updateStatus, recordDelay, listForStation, listDelaysForStation, importTemplate, importFlightSchedule };
