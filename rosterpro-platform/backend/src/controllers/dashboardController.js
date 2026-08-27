const svc = require("../services/dashboardService");
const asyncHandler = require("../utils/asyncHandler");

const qualificationExpiry = asyncHandler(async (req, res) => {
  res.json(await svc.qualificationExpiryWidget(req.params.stationId, parseInt(req.query.days, 10) || undefined));
});
const leaveBalance = asyncHandler(async (req, res) => {
  res.json(await svc.leaveBalanceWidget(req.params.stationId, parseInt(req.query.year, 10) || new Date().getFullYear()));
});
const rosterCoverage = asyncHandler(async (req, res) => {
  res.json(await svc.rosterCoverageWidget(req.params.stationId, req.query.monthKey));
});
const flightCoverage = asyncHandler(async (req, res) => {
  res.json(await svc.flightCoverageWidget(req.params.stationId, req.query.from, req.query.to));
});
const dgcaCompliance = asyncHandler(async (req, res) => {
  res.json(await svc.dgcaComplianceWidget(req.params.stationId));
});
const staffWorkload = asyncHandler(async (req, res) => {
  res.json(await svc.staffWorkloadWidget(req.params.stationId, req.query.monthKey));
});
const today = asyncHandler(async (req, res) => {
  res.json(await svc.todayWidget(req.params.stationId));
});

// One call for the whole dashboard page, since a real dashboard renders
// all six widgets together rather than one at a time.
const summary = asyncHandler(async (req, res) => {
  const { stationId } = req.params;
  const monthKey = req.query.monthKey || new Date().toISOString().slice(0, 7);
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const now = new Date();
  const from = req.query.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const to = req.query.to || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

  const [qualificationExpiry, leaveBalance, dgcaCompliance, flightCoverage, rosterCoverage, staffWorkload, today] = await Promise.all([
    svc.qualificationExpiryWidget(stationId),
    svc.leaveBalanceWidget(stationId, year),
    svc.dgcaComplianceWidget(stationId),
    svc.flightCoverageWidget(stationId, from, to),
    svc.rosterCoverageWidget(stationId, monthKey).catch(() => null), // no roster yet for this month is not an error for the dashboard
    svc.staffWorkloadWidget(stationId, monthKey).catch(() => null),
    svc.todayWidget(stationId),
  ]);

  res.json({ qualificationExpiry, leaveBalance, dgcaCompliance, flightCoverage, rosterCoverage, staffWorkload, today });
});

module.exports = { qualificationExpiry, leaveBalance, rosterCoverage, flightCoverage, dgcaCompliance, staffWorkload, today, summary };
