const prisma = require("../config/prisma");

function create(userId, tokenHash, expiresAt, ip, userAgent) {
  return prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt, ipAddress: ip, userAgent },
  });
}

// Callers only ever need record.userId/record.id — never the joined user
// row, which isn't included here on purpose: `include: { user: true }`
// would pull passwordHash/mfaSecret/reset tokens into memory for no reason
// every time a refresh token is checked.
function findValidByHash(tokenHash) {
  return prisma.refreshToken.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
  });
}

function revoke(id) {
  return prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
}

// "Log out everywhere" — revokes every active token for a user (used on
// password reset/change, and available for a manual "log out all devices"
// action later).
function revokeAllForUser(userId) {
  return prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

module.exports = { create, findValidByHash, revoke, revokeAllForUser };
