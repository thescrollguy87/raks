const { verifyAccessToken } = require("../utils/jwt");
const ApiError = require("../utils/ApiError");
const { enforceBillingGate } = require("./billingGate");

// Populates req.user from a valid Bearer access token. This only checks the
// token is valid and unexpired — it does NOT check permissions, that's
// requirePermission in rbac.js, applied per-route on top of this.
//
// Also runs the subscription read-only gate (enforceBillingGate) right
// after — deliberately folded in here rather than added as a separate line
// callers have to remember to add to every router. requireAuth is already
// the one middleware every protected route in the app runs through without
// exception, so composing the gate here guarantees it can never be missed
// on a new route the way a scattered per-endpoint check could be.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(ApiError.unauthorized("Missing access token"));

  try {
    req.user = verifyAccessToken(token); // { sub, email, name, airlineId, stationId, roles, permissions }
    enforceBillingGate(req, res, next);
  } catch (err) {
    if (err.name === "TokenExpiredError") return next(ApiError.unauthorized("Access token expired"));
    next(ApiError.unauthorized("Invalid access token"));
  }
}

// For routes that behave differently for logged-in vs anonymous callers but
// don't strictly require login (none in Module 2 yet, but kept here since
// it's a one-line addition and commonly needed later).
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next();
  try {
    req.user = verifyAccessToken(token);
  } catch {
    // ignore — treated as anonymous
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
