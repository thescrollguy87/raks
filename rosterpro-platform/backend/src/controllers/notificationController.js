const notificationRepo = require("../repositories/notificationRepository");
const asyncHandler = require("../utils/asyncHandler");

const myNotifications = asyncHandler(async (req, res) => {
  res.json(await notificationRepo.listForUser(req.user.sub, parseInt(req.query.limit, 10) || 50));
});

const notificationsForUser = asyncHandler(async (req, res) => {
  res.json(await notificationRepo.listForUser(req.params.userId, parseInt(req.query.limit, 10) || 50));
});

module.exports = { myNotifications, notificationsForUser };
