const leaveService = require("../services/leaveService");
const userRepo = require("../repositories/userRepository");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { assertOwnStation, resolveStationScope } = require("../utils/stationScope");

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
  // Every caller ends up with a real station-level filter: their own
  // exact station if they're not airline-wide, a verified single station
  // if they named one and it's genuinely theirs, or every station in
  // THEIR OWN airline if they didn't — never "no filter" (an airline-wide
  // caller who omitted stationId used to see every leave request across
  // every airline on the platform).
  const { stationId: requestedStationId, ...restQuery } = req.query;
  const scope = await resolveStationScope(req.user, requestedStationId);
  const query = { ...restQuery, ...scope };

  // A Shift Incharge (leave:approve_reports only, not the station-wide
  // leave:approve) reviewing requests for approval must only ever see
  // their own direct reports — never the whole station's list — unless
  // they're explicitly asking for their own leave history (userId=self).
  const isReportsScopedApprover = req.user.permissions?.includes("leave:approve_reports") && !req.user.permissions?.includes("leave:approve");
  if (isReportsScopedApprover && query.userId !== req.user.sub) {
    query.reportsToId = req.user.sub;
  }

  const result = await leaveService.listLeaves(query);
  res.json(result);
});

const balance = asyncHandler(async (req, res) => {
  const userId = req.params.userId || req.user.sub;
  if (userId !== req.user.sub) {
    const target = await userRepo.findStationId(userId);
    if (!target) throw ApiError.notFound("Staff member not found");
    await assertOwnStation(req.user, target.stationId);
  }
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const result = await leaveService.getBalance(userId, year);
  res.json(result);
});

module.exports = { request, decide, cancel, list, balance };
