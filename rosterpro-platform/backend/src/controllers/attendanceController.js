const attendanceService = require("../services/attendanceService");
const asyncHandler = require("../utils/asyncHandler");
const { resolveStationScope } = require("../utils/stationScope");

// Photo bytes never round-trip back to the client in list/detail views —
// nothing in the UI re-displays them, they're for manual admin review only
// (see photoUrl below), so every response here strips the Buffer and
// reports just whether one exists.
function serialize(record) {
  if (!record) return record;
  const { punchInPhoto, punchOutPhoto, ...rest } = record;
  return { ...rest, hasPunchInPhoto: !!punchInPhoto, hasPunchOutPhoto: !!punchOutPhoto };
}

const today = asyncHandler(async (req, res) => {
  const ctx = await attendanceService.getTodayContext(req.user);
  res.json({ ...ctx, record: serialize(ctx.record) });
});

const punchIn = asyncHandler(async (req, res) => {
  const record = await attendanceService.punchIn(req.body, req.user, req);
  res.status(201).json(serialize(record));
});

const punchOut = asyncHandler(async (req, res) => {
  const record = await attendanceService.punchOut(req.body, req.user, req);
  res.json(serialize(record));
});

// Self-view by default; only attendance:manage holders can see anyone
// else's, mirroring the exact bug fix applied to the Leave module (never
// trust a caller-supplied userId as "show me only mine" — force it).
const list = asyncHandler(async (req, res) => {
  const canManage = req.user.permissions?.includes("attendance:manage");
  const query = { ...req.query };
  if (canManage) {
    const { stationId: requestedStationId, ...rest } = query;
    Object.assign(query, rest, await resolveStationScope(req.user, requestedStationId));
  } else {
    query.userId = req.user.sub;
    delete query.stationId;
  }
  const result = await attendanceService.listRecords(query);
  res.json({ ...result, items: result.items.map(serialize) });
});

const overview = asyncHandler(async (req, res) => {
  const userId = req.query.userId || req.user.sub;
  const canManage = req.user.permissions?.includes("attendance:manage");
  if (userId !== req.user.sub && !canManage) {
    return res.status(403).json({ error: "You can only view your own attendance overview" });
  }
  const days = await attendanceService.buildDailyOverview(userId, req.user.stationId, req.query.from, req.query.to);
  res.json({ userId, days: days.map(d => ({ ...d, record: serialize(d.record) })) });
});

module.exports = { today, punchIn, punchOut, list, overview };
