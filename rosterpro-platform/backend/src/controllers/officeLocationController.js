const officeLocationService = require("../services/officeLocationService");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  const result = await officeLocationService.listLocations(req.user, req.query);
  res.json({ items: result });
});

const create = asyncHandler(async (req, res) => {
  const result = await officeLocationService.createLocation(req.body, req.user, req);
  res.status(201).json(result);
});

const update = asyncHandler(async (req, res) => {
  const result = await officeLocationService.updateLocation(req.params.id, req.body, req.user, req);
  res.json(result);
});

const remove = asyncHandler(async (req, res) => {
  await officeLocationService.deleteLocation(req.params.id, req.user, req);
  res.status(204).send();
});

module.exports = { list, create, update, remove };
