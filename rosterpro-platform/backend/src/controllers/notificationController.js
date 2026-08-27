const notificationRepo = require("../repositories/notificationRepository");
const userRepo = require("../repositories/userRepository");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { isAirlineWide } = require("../utils/stationScope");

const myNotifications = asyncHandler(async (req, res) => {
  res.json(await notificationRepo.listForUser(req.user.sub, parseInt(req.query.limit, 10) || 50));
});

const notificationsForUser = asyncHandler(async (req, res) => {
  if (!isAirlineWide(req.user)) {
    const target = await userRepo.findStationId(req.params.userId);
    if (!target) throw ApiError.notFound("Staff member not found");
    if (target.stationId !== req.user.stationId) {
      throw ApiError.forbidden("You can only view your own station's staff");
    }
  }
  res.json(await notificationRepo.listForUser(req.params.userId, parseInt(req.query.limit, 10) || 50));
});

module.exports = { myNotifications, notificationsForUser };
