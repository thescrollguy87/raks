const svc = require("../services/storeService");
const asyncHandler = require("../utils/asyncHandler");

const create = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createItem(req.body, req.user, req));
});
const movement = asyncHandler(async (req, res) => {
  res.json(await svc.recordMovement(req.params.id, req.body, req.user, req));
});
const listForStation = asyncHandler(async (req, res) => {
  res.json(await svc.listForStation(req.params.stationId));
});
const belowMinStock = asyncHandler(async (req, res) => {
  res.json(await svc.listBelowMinStock(req.params.stationId));
});
const movements = asyncHandler(async (req, res) => {
  res.json(await svc.listMovements(req.params.id));
});

module.exports = { create, movement, listForStation, belowMinStock, movements };
