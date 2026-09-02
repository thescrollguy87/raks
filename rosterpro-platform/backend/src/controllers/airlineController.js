const airlineRepo = require("../repositories/airlineRepository");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  res.json(await airlineRepo.listAirlines());
});

module.exports = { list };
