const ApiError = require("../utils/ApiError");
const prisma = require("../config/prisma");

// Usage: router.post("/roster/publish", requireAuth, requirePermission("roster", "publish"), controller)
//
// Reads the permission list embedded in the access token (see utils/jwt.js)
// rather than hitting the DB on every request. SUPER_ADMIN bypasses the
// check entirely (platform owner, not airline-scoped).
//
// If your app needs permission changes to take effect immediately (not just
// on next token refresh), swap the token-based check below for
// requirePermissionLive, which hits the DB — slower, always current.
function requirePermission(resource, action) {
  return function (req, res, next) {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.roles?.includes("SUPER_ADMIN")) return next();

    const key = `${resource}:${action}`;
    if (!req.user.permissions?.includes(key)) {
      return next(ApiError.forbidden(`Missing permission: ${key}`));
    }
    next();
  };
}

// DB-backed variant — use for sensitive actions where an admin revoking a
// permission should take effect on the very next request, not after the
// access token expires (e.g. deactivating a compromised account's access).
function requirePermissionLive(resource, action) {
  return async function (req, res, next) {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      if (req.user.roles?.includes("SUPER_ADMIN")) return next();

      const count = await prisma.userRole.count({
        where: {
          userId: req.user.sub,
          role: {
            permissions: {
              some: { permission: { resource, action } },
            },
          },
        },
      });
      if (count === 0) return next(ApiError.forbidden(`Missing permission: ${resource}:${action}`));
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Convenience for routes that just need "any of these roles", when the
// action doesn't map cleanly to a single resource:action permission.
function requireRole(...allowedRoles) {
  return function (req, res, next) {
    if (!req.user) return next(ApiError.unauthorized());
    const hasRole = req.user.roles?.some(r => allowedRoles.includes(r));
    if (!hasRole) return next(ApiError.forbidden(`Requires one of: ${allowedRoles.join(", ")}`));
    next();
  };
}

module.exports = { requirePermission, requirePermissionLive, requireRole };
