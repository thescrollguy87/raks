const userRepo = require("../repositories/userRepository");
const userListRepo = require("../repositories/userListRepository");
const stationRepo = require("../repositories/stationRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const { hashPassword, isPasswordStrong } = require("../utils/password");
const { assertOwnStation, isSuperAdmin } = require("../utils/stationScope");

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
  // Whatever station ends up being used — the actor's own, or one an
  // airline-wide actor explicitly chose — must genuinely belong to an
  // airline the actor is allowed to place staff at (this 404s for an
  // AIRLINE_ADMIN naming another airline's station). The new hire's own
  // airlineId is then derived from that station's REAL airline, never
  // copied from the actor's own token — the two only coincide by
  // construction once this check has passed, but deriving it explicitly
  // keeps a SUPER_ADMIN provisioning staff for some other airline correct
  // too, instead of silently stamping their own airlineId onto the row.
  await assertOwnStation(actor, stationId);
  const station = await stationRepo.findStationAirlineId(stationId);

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
    airlineId: station.airlineId,
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
  await assertOwnStation(actor, before.stationId);

  // Only an airline-wide admin can move someone to a different station —
  // a Station Manager who holds staff:update shouldn't be able to smuggle
  // a stationId change through this endpoint to reassign staff elsewhere.
  const isAdmin = ["SUPER_ADMIN", "AIRLINE_ADMIN"].some(r => actor.roles.includes(r));
  let data;
  if (isAdmin && body.stationId && body.stationId !== before.stationId) {
    // Being moved to a genuinely different station — that station must
    // belong to an airline the actor is allowed to place staff at too
    // (same rule as createStaff), or an AIRLINE_ADMIN could otherwise
    // "kidnap" someone into a different tenant entirely just by setting
    // stationId on an update. airlineId is re-derived from wherever they
    // end up so it never drifts out of sync with their actual station.
    await assertOwnStation(actor, body.stationId);
    const station = await stationRepo.findStationAirlineId(body.stationId);
    data = { ...body, airlineId: station.airlineId };
  } else {
    data = isAdmin ? { ...body } : { ...body, stationId: before.stationId };
  }

  const after = await userRepo.update(id, { ...data, updatedById: actor.sub });
  await auditTrail.recordUpdate("User", id, before.stationId, before, body, actor, req);
  return toPublicShape(after);
}

async function setActive(id, isActive, actor, req) {
  const user = await userRepo.findById(id);
  if (!user) throw ApiError.notFound("Staff member not found");
  await assertOwnStation(actor, user.stationId);
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
  await assertOwnStation(actor, user.stationId);

  // SUPER_ADMIN crosses every tenant boundary in this app — granting it is
  // itself a tenant-isolation decision, not an ordinary permissions edit.
  // Without this, an AIRLINE_ADMIN (who legitimately holds users:assign_role
  // for their own airline) could grant SUPER_ADMIN to anyone at their own
  // station and hand them unrestricted cross-airline access — a full
  // escalation around everything else this audit fixed. Only someone who
  // is already SUPER_ADMIN may grant or revoke it.
  if (roleNames.includes("SUPER_ADMIN") && !isSuperAdmin(actor)) {
    throw ApiError.forbidden("Only a Super Admin can grant the Super Admin role");
  }

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
  await assertOwnStation(actor, user.stationId);

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
