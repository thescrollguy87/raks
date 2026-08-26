const leaveService = require("../services/leaveService");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const request = asyncHandler(async (req, res) => {
  // Non-managers can only request leave for themselves — the validator
  // allows an explicit userId (for a manager filing on someone's behalf),
  // this is where that's actually enforced.
  const canFileForOthers = req.user.roles?.some(r => ["SUPER_ADMIN", "AIRLINE_ADMIN", "STATION_MANAGER", "LMM"].includes(r));
  if (req.body.userId && req.body.userId !== req.user.sub && !canFileForOthers) {
    throw ApiError.forbidden("You can only request leave for yourself");
  }
  const result = await leaveService.requestLeave(req.body, req.user, req);
  res.status(201).json(result);
});

const decide = asyncHandler(async (req, res) => {
  const result = await leaveService.decideLeave(req.params.id, req.body, req.user, req);
  res.json(result);
});

const cancel = asyncHandler(async (req, res) => {
  const result = await leaveService.cancelLeave(req.params.id, req.user, req);
  res.json(result);
});

const list = asyncHandler(async (req, res) => {
  const result = await leaveService.listLeaves(req.query);
  res.json(result);
});

const balance = asyncHandler(async (req, res) => {
  const userId = req.params.userId || req.user.sub;
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const result = await leaveService.getBalance(userId, year);
  res.json(result);
});

module.exports = { request, decide, cancel, list, balance };
