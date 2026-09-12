const service = require("../services/departureAllocationService");
const asyncHandler = require("../utils/asyncHandler");

const getDay = asyncHandler(async (req, res) => {
  const { stationId, year, month, day } = req.query;
  const result = await service.getDayAllocation(stationId, year, month, day, req.user);
  res.json(result);
});

const autoAllocate = asyncHandler(async (req, res) => {
  const { stationId, year, month, day } = req.body;
  const result = await service.autoAllocateDay(stationId, year, month, day, req.user, req);
  res.json(result);
});

const manualAssign = asyncHandler(async (req, res) => {
  const result = await service.manualAssign(req.body, req.user, req);
  res.json(result);
});

module.exports = { getDay, autoAllocate, manualAssign };
