const billingService = require("../services/billingService");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

// Every action below is scoped to the CALLER'S OWN airline — there is no
// per-tenant billing view for SUPER_ADMIN (whose JWT carries no single
// airlineId, by design; see stationScope.js). That's deliberate: the
// Billing page is Airline Admin only, and a SUPER_ADMIN inspecting a
// tenant's billing is an ops task for the admin/run-cycle endpoint below,
// not this one. Guarded here rather than left to crash on a null-airlineId
// Prisma call the way earlier roster endpoints did before that class of
// bug was fixed.
function requireOwnAirline(req) {
  if (!req.user.airlineId) throw ApiError.badRequest("This account is not scoped to a single airline");
  return req.user.airlineId;
}

const getStatus = asyncHandler(async (req, res) => {
  res.json(await billingService.getStatus(requireOwnAirline(req)));
});

const getCharges = asyncHandler(async (req, res) => {
  res.json(await billingService.listCharges(requireOwnAirline(req)));
});

const createAuthorizationOrder = asyncHandler(async (req, res) => {
  res.json(await billingService.createAuthorizationOrder(requireOwnAirline(req), req.user));
});

const confirmPaymentMethod = asyncHandler(async (req, res) => {
  res.json(await billingService.confirmPaymentMethod(requireOwnAirline(req), req.body, req.user, req));
});

// SUPER_ADMIN-only operational tool: fire the billing cycle immediately for
// one tenant (or every due tenant, if airlineId is omitted) instead of
// waiting for the daily cron. `asOf` lets a specific run be evaluated as
// though it were a later date — the mechanism behind "fast-forward the
// trial and confirm read-only" in testing, and a genuinely useful support
// tool in production (re-run today's cycle for a tenant without waiting
// for tomorrow's cron). `forceFailure` deterministically declines the
// charge attempt (see integrations/razorpayClient.js's fake client) — for
// exercising the grace-period/retry path without a real card decline.
const runCycleNow = asyncHandler(async (req, res) => {
  const { airlineId, asOf, forceFailure } = req.body || {};
  const now = asOf ? new Date(asOf) : new Date();
  const results = await billingService.runDueCycles(now, { onlyAirlineId: airlineId, forceFailure: !!forceFailure });
  res.json({ now: now.toISOString(), results });
});

module.exports = { getStatus, getCharges, createAuthorizationOrder, confirmPaymentMethod, runCycleNow };
