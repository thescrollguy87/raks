const airlineRepo = require("../repositories/airlineRepository");
const airlineService = require("../services/airlineService");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  res.json(await airlineRepo.listAirlines());
});

const create = asyncHandler(async (req, res) => {
  const result = await airlineService.createAirline(req.body, req.user, req);
  res.status(201).json(result);
});

module.exports = { list, create };
