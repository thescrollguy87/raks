const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const env = require("../config/env");

// Access token carries the permission list so the RBAC middleware doesn't
// need a DB round-trip on every request. Its short TTL (15 min default)
// bounds how stale that permission snapshot can get if an admin changes a
// role's permissions mid-session — acceptable for this app; if you need
// permission changes to apply instantly, swap the RBAC middleware to check
// the DB directly (see the comment in middleware/rbac.js).
function signAccessToken(user, permissions) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.fullName,
      airlineId: user.airlineId,
      stationId: user.stationId,
      roles: user.roles,
      permissions, // ["roster:read", "roster:publish", ...]
    },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessTtl }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

// Refresh tokens are opaque random strings, not JWTs — they're stored
// hashed in the DB (refresh_tokens.tokenHash) and can be individually
// revoked (logout, "log out all devices", password reset). A JWT refresh
// token can't be revoked without a blocklist, which is more moving parts
// than just storing it directly.
function generateRefreshToken() {
  return crypto.randomBytes(48).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = { signAccessToken, verifyAccessToken, generateRefreshToken, hashToken };
