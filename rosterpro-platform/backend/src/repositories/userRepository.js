const prisma = require("../config/prisma");

// Repositories only talk to Prisma — no password hashing, no token issuing,
// no business rules. That all lives in services/. This separation is what
// makes the service layer unit-testable without a real database (mock the
// repository) and lets the storage layer change later without touching
// business logic.

const userInclude = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
};

function findByEmail(email) {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: userInclude });
}

function findById(id) {
  return prisma.user.findUnique({ where: { id }, include: userInclude });
}

// Who to notify for station-level operational alerts (low stock, tool
// calibration due) — active users at the station holding any of the given
// roles. Used instead of a single hardcoded "station manager" field so it
// keeps working as roles/assignments change.
async function findContactsByRoleAtStation(stationId, roleNames) {
  const rows = await prisma.user.findMany({
    where: {
      stationId, isActive: true, deletedAt: null,
      roles: { some: { role: { name: { in: roleNames } } } },
    },
    select: { id: true, fullName: true, email: true, phone: true },
  });
  return rows;
}

function updateLoginMeta(id, ip) {
  return prisma.user.update({
    where: { id },
    data: { lastLoginAt: new Date(), lastLoginIp: ip },
  });
}

function updatePasswordHash(id, passwordHash) {
  return prisma.user.update({
    where: { id },
    data: { passwordHash, passwordResetToken: null, passwordResetExpiry: null, version: { increment: 1 } },
  });
}

function setPasswordResetToken(id, token, expiry) {
  return prisma.user.update({ where: { id }, data: { passwordResetToken: token, passwordResetExpiry: expiry } });
}

function findByPasswordResetToken(token) {
  return prisma.user.findFirst({ where: { passwordResetToken: token, passwordResetExpiry: { gt: new Date() } } });
}

function setEmailVerifyToken(id, token, expiry) {
  return prisma.user.update({ where: { id }, data: { emailVerifyToken: token, emailVerifyExpiry: expiry } });
}

function findByEmailVerifyToken(token) {
  return prisma.user.findFirst({ where: { emailVerifyToken: token, emailVerifyExpiry: { gt: new Date() } } });
}

function markEmailVerified(id) {
  return prisma.user.update({
    where: { id },
    data: { isEmailVerified: true, emailVerifyToken: null, emailVerifyExpiry: null },
  });
}

function setMfaSecret(id, secretEncrypted) {
  return prisma.user.update({ where: { id }, data: { mfaSecret: secretEncrypted } });
}

function setMfaEnabled(id, enabled) {
  return prisma.user.update({ where: { id }, data: { mfaEnabled: enabled } });
}

// Flattens the nested roles→role→permissions→permission shape from Prisma
// into the simple string arrays the JWT and RBAC middleware expect.
function flattenRolesAndPermissions(userWithRoles) {
  const roles = userWithRoles.roles.map(ur => ur.role.name);
  const permissionSet = new Set();
  for (const ur of userWithRoles.roles) {
    for (const rp of ur.role.permissions) {
      permissionSet.add(`${rp.permission.resource}:${rp.permission.action}`);
    }
  }
  return { roles, permissions: [...permissionSet] };
}

module.exports = {
  findByEmail, findById, updateLoginMeta, updatePasswordHash,
  setPasswordResetToken, findByPasswordResetToken,
  setEmailVerifyToken, findByEmailVerifyToken, markEmailVerified,
  setMfaSecret, setMfaEnabled,
  flattenRolesAndPermissions, findContactsByRoleAtStation,
};
