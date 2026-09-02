const userRepo = require("../repositories/userRepository");
const userListRepo = require("../repositories/userListRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const { hashPassword, isPasswordStrong } = require("../utils/password");
const { assertOwnStation } = require("../utils/stationScope");

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
    reportsToId: user.reportsToId, reportsToName: user.reportsTo?.fullName || null,
    createdAt: user.createdAt, roles,
  };
}

async function createStaff(body, actor, req) {
  if (!isPasswordStrong(body.password)) {
    throw ApiError.badRequest("Password must be at least 10 characters and include a letter and a number");
  }
  // Non-admin roles are station-scoped by the actor's own token, same rule
  // userController.list already applies — an admin can place a new hire at
  // any station, everyone else can only add to their own. An admin who
  // omits stationId entirely used to silently create a stationless staff
  // record — invisible from every station-scoped screen (Staff Registry,
  // Roster, …) with no error at all. Reject that explicitly instead: a
  // brand-new staff member with nowhere to work is never a valid state.
  const isAirlineWideActor = ["SUPER_ADMIN", "AIRLINE_ADMIN"].some(r => actor.roles.includes(r));
  const stationId = isAirlineWideActor ? (body.stationId || null) : actor.stationId;
  if (!stationId) {
    throw ApiError.badRequest("A station is required to add a new staff member");
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
    reportsToId: body.reportsToId || null,
    stationId,
    airlineId: actor.airlineId || null,
    isEmailVerified: true, // an admin-created account doesn't need self-verification
    createdById: actor.sub,
  });
  await userRepo.setRoles(user.id, body.roles);
  const withRoles = await userRepo.findById(user.id);

  await auditTrail.recordCreate("User", user.id, user.stationId, actor, req);
  await auditTrail.logActivity("Staff added", `${user.fullName} (${body.roles.join(", ")})`, user.stationId, actor, req);
  return toPublicShape(withRoles);
}

async function updateStaff(id, body, actor, req) {
  const before = await userRepo.findById(id);
  if (!before) throw ApiError.notFound("Staff member not found");
  assertOwnStation(actor, before.stationId);

  // Only an airline-wide admin can move someone to a different station —
  // a Station Manager who holds staff:update shouldn't be able to smuggle
  // a stationId change through this endpoint to reassign staff elsewhere.
  const isAdmin = ["SUPER_ADMIN", "AIRLINE_ADMIN"].some(r => actor.roles.includes(r));
  const data = isAdmin ? { ...body } : { ...body, stationId: before.stationId };

  const after = await userRepo.update(id, { ...data, updatedById: actor.sub });
  await auditTrail.recordUpdate("User", id, before.stationId, before, body, actor, req);
  return toPublicShape(after);
}

async function setActive(id, isActive, actor, req) {
  const user = await userRepo.findById(id);
  if (!user) throw ApiError.notFound("Staff member not found");
  assertOwnStation(actor, user.stationId);
  if (user.isActive === isActive) return toPublicShape(user); // no-op, already in that state

  const updated = await userRepo.setActive(id, isActive);
  await auditTrail.logActivity(
    isActive ? "Staff reactivated" : "Staff marked inactive",
    user.fullName, user.stationId, actor, req
  );
  return toPublicShape(updated);
}

async function assignRoles(id, roleNames, actor, req) {
  const user = await userRepo.findById(id);
  if (!user) throw ApiError.notFound("Staff member not found");
  assertOwnStation(actor, user.stationId);

  await userRepo.setRoles(id, roleNames);
  const updated = await userRepo.findById(id);
  await auditTrail.logActivity("Roles updated", `${user.fullName}: ${roleNames.join(", ")}`, user.stationId, actor, req);
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
  assertOwnStation(actor, user.stationId);

  // Checked up front (not just caught as a generic FK failure after the
  // fact) so the message names EXACTLY which historical record is
  // blocking — a Shift Pattern assignment, a staff group membership, a
  // departure manpower assignment, or quality audit-finding/CAPA history
  // are all deliberately non-cascading, but they're five different things
  // and "some record exists somewhere" isn't actionable.
  const blockers = await userRepo.findDeleteBlockers(id);
  if (blockers.length) {
    throw ApiError.conflict(
      `Cannot permanently delete ${user.fullName} — they still have ${blockers.join(", ")}. Deactivate instead to remove them from future scheduling, or reassign/remove those records first if they truly must be deleted.`
    );
  }

  await auditTrail.recordDelete("User", id, user.stationId, actor, req);
  try {
    await userRepo.hardDelete(id);
  } catch (err) {
    if (err.code === "P2003") {
      // Fallback for any non-cascading relation not covered by
      // findDeleteBlockers above (e.g. a new one added later and missed
      // here) — still a clean 409, never a raw 500.
      throw ApiError.conflict(
        `Cannot permanently delete ${user.fullName} — they have other historical records tied to their account. Deactivate instead to remove them from future scheduling.`
      );
    }
    throw err;
  }
  await auditTrail.logActivity("Staff deleted", user.fullName, user.stationId, actor, req);
  return { ok: true };
}

module.exports = { createStaff, updateStaff, setActive, assignRoles, deleteStaff, listPaginated: userListRepo.listPaginated };
