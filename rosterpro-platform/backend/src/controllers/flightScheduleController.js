const flightScheduleService = require("../services/flightScheduleService");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const importSchedule = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest("No file uploaded");
  const { stationId, year, month } = req.query;
  const result = await flightScheduleService.importFlightSchedule(stationId, year, month, req.file.buffer, req.user, req);
  res.json(result);
});

const getSchedule = asyncHandler(async (req, res) => {
  const { stationId, year, month } = req.query;
  const result = await flightScheduleService.getFlightScheduleView(stationId, Number(year), Number(month));
  res.json(result);
});

module.exports = { importSchedule, getSchedule };
