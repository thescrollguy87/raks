const svc = require("../services/flightService");
const asyncHandler = require("../utils/asyncHandler");

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

module.exports = { create, updateStatus, recordDelay, listForStation, listDelaysForStation };
