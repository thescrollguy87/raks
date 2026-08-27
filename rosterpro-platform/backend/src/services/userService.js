const userRepo = require("../repositories/userRepository");
const userListRepo = require("../repositories/userListRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const { hashPassword, isPasswordStrong } = require("../utils/password");

// Fields a caller is allowed to see changed/created — mirrors what
// userListRepository already selects, so create/update responses look like
// the same shape the list screen expects, not the full row (no passwordHash
// leaking out, etc).
function toPublicShape(user) {
  const { roles } = userRepo.flattenRolesAndPermissions(user);
  return {
    id: user.id, fullName: user.fullName, email: user.email, employeeId: user.employeeId,
    phone: user.phone, category: user.category, designation: user.designation,
    isActive: user.isActive, stationId: user.stationId, airlineId: user.airlineId,
    createdAt: user.createdAt, roles,
  };
}

async function createStaff(body, actor, req) {
  if (!isPasswordStrong(body.password)) {
    throw ApiError.badRequest("Password must be at least 10 characters and include a letter and a number");
  }
  const passwordHash = await hashPassword(body.password);
  const user = await userRepo.create({
    email: body.email.toLowerCase(),
    passwordHash,
    fullName: body.fullName,
    employeeId: body.employeeId || null,
    phone: body.phone || null,
    category: body.category || null,
    designation: body.designation || null,
    // Non-admin roles are station-scoped by the actor's own token, same
    // rule userController.list already applies — an admin can place a new
    // hire at any station, everyone else can only add to their own.
    stationId: ["SUPER_ADMIN", "AIRLINE_ADMIN"].some(r => actor.roles.includes(r))
      ? (body.stationId || null) : actor.stationId,
    airlineId: actor.airlineId || null,
    isEmailVerified: true, // an admin-created account doesn't need self-verification
    createdById: actor.sub,
  });
  await userRepo.setRoles(user.id, body.roles);
  const withRoles = await userRepo.findById(user.id);

  await auditTrail.recordCreate("User", user.id, actor, req);
  await auditTrail.logActivity("Staff added", `${user.fullName} (${body.roles.join(", ")})`, actor, req);
  return toPublicShape(withRoles);
}

async function updateStaff(id, body, actor, req) {
  const before = await userRepo.findById(id);
  if (!before) throw ApiError.notFound("Staff member not found");

  const after = await userRepo.update(id, { ...body, updatedById: actor.sub });
  await auditTrail.recordUpdate("User", id, before, body, actor, req);
  return toPublicShape(after);
}

async function setActive(id, isActive, actor, req) {
  const user = await userRepo.findById(id);
  if (!user) throw ApiError.notFound("Staff member not found");
  if (user.isActive === isActive) return toPublicShape(user); // no-op, already in that state

  const updated = await userRepo.setActive(id, isActive);
  await auditTrail.logActivity(
    isActive ? "Staff reactivated" : "Staff marked inactive",
    user.fullName, actor, req
  );
  return toPublicShape(updated);
}

async function assignRoles(id, roleNames, actor, req) {
  const user = await userRepo.findById(id);
  if (!user) throw ApiError.notFound("Staff member not found");

  await userRepo.setRoles(id, roleNames);
  const updated = await userRepo.findById(id);
  await auditTrail.logActivity("Roles updated", `${user.fullName}: ${roleNames.join(", ")}`, actor, req);
  return toPublicShape(updated);
}

// PERMANENT delete — distinct from setActive(false), which just hides
// someone from future scheduling but keeps their history. This actually
// removes the row; qualifications/licenses/trainings/authorizations/leaves/
// shift assignments/notifications/roles/sessions go with it (see the
// user_delete_cascades migration). A person who's ever raised a quality
// audit finding or owns a CAPA can't be hard-deleted — those two tables
// were left as-is (Quality module is deprecated but its historical rows
// are kept per the earlier removal work) — caught below and turned into a
// clear message rather than a raw foreign-key error.
async function deleteStaff(id, actor, req) {
  const user = await userRepo.findById(id);
  if (!user) throw ApiError.notFound("Staff member not found");

  await auditTrail.recordDelete("User", id, actor, req);
  try {
    await userRepo.hardDelete(id);
  } catch (err) {
    if (err.code === "P2003") {
      throw ApiError.conflict(
        `Cannot permanently delete ${user.fullName} — they have historical quality audit-finding or CAPA records tied to their account. Deactivate instead to remove them from future scheduling.`
      );
    }
    throw err;
  }
  await auditTrail.logActivity("Staff deleted", user.fullName, actor, req);
  return { ok: true };
}

module.exports = { createStaff, updateStaff, setActive, assignRoles, deleteStaff, listPaginated: userListRepo.listPaginated };
