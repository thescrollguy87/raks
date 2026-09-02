const prisma = require("../config/prisma");

// Repositories only talk to Prisma — no password hashing, no token issuing,
// no business rules. That all lives in services/. This separation is what
// makes the service layer unit-testable without a real database (mock the
// repository) and lets the storage layer change later without touching
// business logic.

const userInclude = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  station: { select: { id: true, name: true, iataCode: true } },
  reportsTo: { select: { id: true, fullName: true } },
};

function findByEmail(email) {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: userInclude });
}

function findById(id) {
  return prisma.user.findUnique({ where: { id }, include: userInclude });
}

// Lean lookup for station-scoping checks (compliance records, leave
// balance, etc.) that only need to know which station a user belongs to —
// avoids pulling the full roles/permissions tree on every such check.
function findStationId(id) {
  return prisma.user.findUnique({ where: { id }, select: { stationId: true } });
}

// Lean lookup for leave-approval scoping — a Shift Incharge (leave:approve_reports
// only, not the station-wide leave:approve) can decide a leave request only
// for someone whose reportsToId is literally them.
function findStationAndManager(id) {
  return prisma.user.findUnique({ where: { id }, select: { stationId: true, reportsToId: true } });
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

function create(data) {
  return prisma.user.create({ data, include: userInclude });
}

function update(id, data) {
  return prisma.user.update({
    where: { id },
    data: { ...data, version: { increment: 1 } },
    include: userInclude,
  });
}

function setActive(id, isActive) {
  return prisma.user.update({
    where: { id },
    data: { isActive, version: { increment: 1 } },
    include: userInclude,
  });
}

// Replaces the user's entire role set — matches the seeded "users:assign_role"
// permission, which anticipates exactly this (not incremental add/remove).
function setRoles(userId, roleNames) {
  return prisma.$transaction(async (tx) => {
    const roles = await tx.role.findMany({ where: { name: { in: roleNames } } });
    await tx.userRole.deleteMany({ where: { userId } });
    await tx.userRole.createMany({ data: roles.map(r => ({ userId, roleId: r.id })) });
  });
}

// Grants one additional role without touching any others a person already
// holds — used by the Employee Master import's Role column, which is meant
// to correct/set someone's primary operational role, not silently wipe out
// an extra grant like LMM on top of their base AME role (setRoles would).
async function addRole(userId, roleName) {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) return;
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: {}, create: { userId, roleId: role.id },
  });
}

// Real, irreversible delete — distinct from setActive(false), which is the
// reversible "remove from future scheduling but keep history" action. Only
// safe because every dependent table that's meaningless without the user
// (qualifications, licenses, trainings, authorizations, leaves, shift
// assignments, notifications, roles, refresh tokens) cascades, and tables
// that represent someone else's/shared history (tool issues, activity log)
// just detach (SetNull) rather than losing the record itself. See the
// user_delete_cascades migration for the full mapping.
function hardDelete(id) {
  return prisma.user.delete({ where: { id } });
}

// Every relation to User deliberately left NOT cascading (unlike the ones
// listed above) because the record is meaningful even after the person is
// gone — a Shift Pattern assignment, a Rule Builder staff group
// membership, a departure's real releaser/support history, a quality
// audit finding they raised, or a CAPA they own. A hard delete correctly
// fails against any of these (Postgres FK violation), but that failure on
// its own doesn't tell the caller WHICH one — this runs the same checks
// up front so deleteStaff can name them specifically instead of just
// "some historical record exists somewhere."
async function findDeleteBlockers(userId) {
  const [pattern, staffGroupCount, releaserCount, supportCount, auditFindingCount, capaCount] = await Promise.all([
    prisma.staffShiftAllocation.findUnique({ where: { userId } }),
    prisma.workloadRuleStaffGroupMember.count({ where: { userId } }),
    prisma.departureManpowerAssignment.count({ where: { releaserUserId: userId } }),
    prisma.departureManpowerAssignment.count({ where: { supportUserId: userId } }),
    prisma.auditFinding.count({ where: { raisedById: userId } }),
    prisma.capa.count({ where: { ownerId: userId } }),
  ]);
  const blockers = [];
  if (pattern) blockers.push("a Shift Pattern assignment");
  if (staffGroupCount) blockers.push(`${staffGroupCount} Rule Builder staff group membership${staffGroupCount === 1 ? "" : "s"}`);
  const departureCount = releaserCount + supportCount;
  if (departureCount) blockers.push(`${departureCount} departure manpower assignment${departureCount === 1 ? "" : "s"}`);
  if (auditFindingCount) blockers.push(`${auditFindingCount} quality audit finding${auditFindingCount === 1 ? "" : "s"} they raised`);
  if (capaCount) blockers.push(`${capaCount} CAPA record${capaCount === 1 ? "" : "s"} they own`);
  return blockers;
}

// Lean, exhaustive (non-paginated) roster of one station's active staff —
// for the Employee Master import's ID/name matching, which needs to check
// every row against every staff member at the station, not one page of them.
function findActiveByStation(stationId) {
  return prisma.user.findMany({
    where: { stationId, isActive: true, deletedAt: null },
    select: {
      id: true, employeeId: true, fullName: true, email: true, phone: true, designation: true, category: true, department: true,
      reportsToId: true, reportsTo: { select: { id: true, employeeId: true, fullName: true } },
      roles: { select: { role: { select: { name: true } } } },
    },
  });
}

module.exports = {
  findByEmail, findById, findStationId, findStationAndManager, findActiveByStation, updateLoginMeta, updatePasswordHash,
  setPasswordResetToken, findByPasswordResetToken,
  setEmailVerifyToken, findByEmailVerifyToken, markEmailVerified,
  setMfaSecret, setMfaEnabled,
  flattenRolesAndPermissions, findContactsByRoleAtStation,
  create, update, setActive, setRoles, addRole, hardDelete, findDeleteBlockers,
};
