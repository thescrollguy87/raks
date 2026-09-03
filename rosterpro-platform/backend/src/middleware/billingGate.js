const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// THE read-only enforcement point — composed directly into requireAuth
// (see middleware/auth.js) rather than applied per-route, so it is
// impossible for a new route to forget it: any route that authenticates
// at all (i.e. every protected route in this app, without exception)
// already runs through requireAuth, and therefore already runs through
// this. "Read-only" is enforced identically for every role including
// AIRLINE_ADMIN — there is no admin bypass.
//
// GET/HEAD/OPTIONS always pass — the spec is explicit that every read
// keeps working. SUPER_ADMIN has no single airlineId (never gated: the
// platform owner isn't "inside" any one tenant's billing status). The
// billing router's own endpoints are exempt by path, since add-payment-
// method/reactivate must themselves stay reachable from read_only — that's
// the only way out of it.
async function enforceBillingGate(req, res, next) {
  try {
    if (SAFE_METHODS.has(req.method)) return next();
    if (!req.user?.airlineId) return next();
    if (req.originalUrl.startsWith("/api/billing")) return next();

    const billing = await prisma.airlineBilling.findUnique({
      where: { airlineId: req.user.airlineId },
      select: { status: true },
    });
    // No billing row at all (shouldn't happen once every tenant is
    // provisioned through the trial-bootstrap path) fails open rather than
    // locking out a tenant over a data gap — never the intended failure mode.
    if (!billing) return next();

    if (billing.status === "read_only" || billing.status === "cancelled") {
      throw ApiError.paymentRequired(
        "Subscription required — this airline's account is read-only. Add a payment method on the Billing page to restore full access."
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { enforceBillingGate };
