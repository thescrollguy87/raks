const stationRepo = require("../repositories/stationRepository");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user.roles?.includes("SUPER_ADMIN");
  res.json(await stationRepo.listStations({ airlineId: req.user.airlineId, isSuperAdmin }));
});

module.exports = { list };
