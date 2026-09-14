const holidayService = require("../services/holidayService");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  const result = await holidayService.listHolidays(req.user, req.query);
  res.json(result);
});

const create = asyncHandler(async (req, res) => {
  const result = await holidayService.createHoliday(req.body, req.user, req);
  res.status(201).json(result);
});

const update = asyncHandler(async (req, res) => {
  const result = await holidayService.updateHoliday(req.params.id, req.body, req.user, req);
  res.json(result);
});

const remove = asyncHandler(async (req, res) => {
  await holidayService.deleteHoliday(req.params.id, req.user, req);
  res.status(204).send();
});

module.exports = { list, create, update, remove };
