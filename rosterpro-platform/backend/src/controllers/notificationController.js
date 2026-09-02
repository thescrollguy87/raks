const notificationRepo = require("../repositories/notificationRepository");
const userRepo = require("../repositories/userRepository");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { assertOwnStation } = require("../utils/stationScope");

const myNotifications = asyncHandler(async (req, res) => {
  res.json(await notificationRepo.listForUser(req.user.sub, parseInt(req.query.limit, 10) || 50));
});

const notificationsForUser = asyncHandler(async (req, res) => {
  const target = await userRepo.findStationId(req.params.userId);
  if (!target) throw ApiError.notFound("Staff member not found");
  await assertOwnStation(req.user, target.stationId);
  res.json(await notificationRepo.listForUser(req.params.userId, parseInt(req.query.limit, 10) || 50));
});

module.exports = { myNotifications, notificationsForUser };
