const regularizationService = require("../services/regularizationService");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { resolveStationScope } = require("../utils/stationScope");

const create = asyncHandler(async (req, res) => {
  // Mirrors leaveController.request's "who may file for someone else"
  // guard, with SHIFT_INCHARGE (the L1 Manager role) explicitly included —
  // the spec calls out "a staff member or their L1 Manager on their
  // behalf" by name, unlike leave requests where this role wasn't given
  // that ability.
  const canFileForOthers = req.user.roles?.some(r => ["SUPER_ADMIN", "AIRLINE_ADMIN", "STATION_MANAGER", "LMM", "SHIFT_INCHARGE"].includes(r));
  if (req.body.userId && req.body.userId !== req.user.sub && !canFileForOthers) {
    throw ApiError.forbidden("You can only submit a regularization request for yourself");
  }
  const result = await regularizationService.createRequest(req.body, req.user, req);
  res.status(201).json(result);
});

const decide = asyncHandler(async (req, res) => {
  const result = await regularizationService.decide(req.params.id, req.body, req.user, req);
  res.json(result);
});

const cancel = asyncHandler(async (req, res) => {
  const result = await regularizationService.cancel(req.params.id, req.user, req);
  res.json(result);
});

// Same visibility pattern as leaveController.list: a reports-scoped
// approver (regularization:approve_reports only) is narrowed to their own
// direct reports unless they're explicitly asking about themselves; a
// station-wide approver/manager sees their resolved station scope.
const list = asyncHandler(async (req, res) => {
  const { stationId: requestedStationId, ...restQuery } = req.query;
  const scope = await resolveStationScope(req.user, requestedStationId);
  const query = { ...restQuery, ...scope };

  const isReportsScopedApprover = req.user.permissions?.includes("regularization:approve_reports") && !req.user.permissions?.includes("regularization:approve");
  if (isReportsScopedApprover && query.userId !== req.user.sub) {
    query.reportsToId = req.user.sub;
  } else if (!req.user.permissions?.includes("regularization:approve") && !req.user.permissions?.includes("regularization:approve_reports")) {
    // A plain staff member (no approval rights at all) only ever sees their own.
    query.userId = req.user.sub;
    delete query.stationId; delete query.stationIdIn;
  }

  const result = await regularizationService.list(query);
  res.json(result);
});

module.exports = { create, decide, cancel, list };
