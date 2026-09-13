const chatAssistantService = require("../services/chatAssistantService");
const asyncHandler = require("../utils/asyncHandler");
const { resolveStationScope } = require("../utils/stationScope");

const ask = asyncHandler(async (req, res) => {
  const result = await chatAssistantService.askAssistant(req.body, req.user, req);
  res.json(result);
});

// Same station-scoping pattern as auditController.listAuditTrail — a
// station-scoped caller only ever sees their own station's conversations;
// an airline-wide caller sees their whole airline unless they narrow to
// one station; SUPER_ADMIN can narrow to any single station or see none
// filtered (query param optional, not station-wide by default here since
// there's no "everything" list without a station named — matches the
// audit trail's own resolveStationScope contract exactly).
const listLog = asyncHandler(async (req, res) => {
  const { from, to, stationId: requestedStationId, ...rest } = req.query;
  const scope = await resolveStationScope(req.user, requestedStationId);
  res.json(await chatAssistantService.listConversationLog({
    ...rest, ...scope, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined,
  }));
});

module.exports = { ask, listLog };
