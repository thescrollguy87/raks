const stationRepo = require("../repositories/stationRepository");
const stationService = require("../services/stationService");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user.roles?.includes("SUPER_ADMIN");
  res.json(await stationRepo.listStations({ airlineId: req.user.airlineId, isSuperAdmin }));
});

const create = asyncHandler(async (req, res) => {
  const station = await stationService.createStation(req.body, req.user, req);
  res.status(201).json(station);
});

module.exports = { list, create };
