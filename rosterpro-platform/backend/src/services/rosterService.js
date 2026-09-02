const rosterRepo = require("../repositories/rosterRepository");
const userRepo = require("../repositories/userRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const notificationService = require("./notificationService");
const { assertOwnStation } = require("../utils/stationScope");

async function getOrCreateRoster(stationId, monthKey, actor) {
  let roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  if (!roster) {
    roster = await rosterRepo.createRoster(stationId, monthKey, actor.sub);
    await auditTrail.recordCreate("Roster", roster.id, stationId, actor, null);
    await auditTrail.logActivity("Roster created", `${stationId} — ${monthKey}`, stationId, actor, null);
  }
  return roster;
}

async function getRosterGrid(stationId, monthKey, actor) {
  const roster = await getOrCreateRoster(stationId, monthKey, actor);
  const grid = await rosterRepo.getRosterGrid(stationId, roster.id);
  return { roster, staff: grid };
}

async function publishRoster(rosterId, actor, req) {
  const roster = await rosterRepo.findRosterById(rosterId);
  if (!roster) throw ApiError.notFound("Roster not found");
  assertOwnStation(actor, roster.stationId);
  if (roster.isPublished) throw ApiError.conflict("Roster is already published");

  const updated = await rosterRepo.publishRoster(rosterId, actor.sub);
  await auditTrail.recordUpdate(
    "Roster", rosterId, roster.stationId,
    { isPublished: roster.isPublished },
    { isPublished: true },
    actor, req, "Roster published"
  );
  await auditTrail.logActivity("Roster published", `${roster.stationId} — ${roster.monthKey}`, roster.stationId, actor, req);

  // Fan out "your roster is published" to every active staff member at the
  // station — fire-and-forget: notificationService never throws, so a
  // delivery failure can't roll back the publish itself.
  const [station, staff] = await Promise.all([
    rosterRepo.findStationById(roster.stationId),
    rosterRepo.getActiveStaffContacts(roster.stationId),
  ]);
  notificationService.notifyRosterPublished(staff, { stationName: station?.name || roster.stationId, monthKey: roster.monthKey })
    .catch(err => auditTrail.logActivity("Notification error", `Roster published fan-out: ${err.message}`, roster.stationId, actor, req));

  return updated;
}

// Deliberately a separate, more tightly-permissioned action from publishing
// (see rosterRoutes.js — requires roster:unpublish, not just roster:publish).
// Reopening a published roster means staff may already be relying on it for
// their next shift, so this always requires a reason for the audit trail.
async function unpublishRoster(rosterId, reason, actor, req) {
  const roster = await rosterRepo.findRosterById(rosterId);
  if (!roster) throw ApiError.notFound("Roster not found");
  assertOwnStation(actor, roster.stationId);
  if (!roster.isPublished) throw ApiError.conflict("Roster is not currently published");
  if (!reason || !reason.trim()) throw ApiError.badRequest("A reason is required to unpublish a live roster");

  const updated = await rosterRepo.unpublishRoster(rosterId, actor.sub);
  await auditTrail.recordUpdate(
    "Roster", rosterId, roster.stationId,
    { isPublished: true },
    { isPublished: false },
    actor, req, reason
  );
  await auditTrail.logActivity("Roster unpublished", `${roster.stationId} — ${roster.monthKey}: ${reason}`, roster.stationId, actor, req);

  // More urgent than the publish notification — staff may already be
  // relying on shifts that are now subject to change.
  const [station, staff] = await Promise.all([
    rosterRepo.findStationById(roster.stationId),
    rosterRepo.getActiveStaffContacts(roster.stationId),
  ]);
  notificationService.notifyRosterUnpublished(staff, { stationName: station?.name || roster.stationId, monthKey: roster.monthKey, reason })
    .catch(err => auditTrail.logActivity("Notification error", `Roster unpublished fan-out: ${err.message}`, roster.stationId, actor, req));

  return updated;
}

// Resolves the old shift's human-readable code (before.shiftDefId is a raw
// FK, not a code) and the affected user's contact details, then fires the
// change alert — deliberately not awaited by the caller, so a slow or
// failing notification never delays the API response for the shift edit
// itself. Every failure path logs to the activity log rather than throwing.
async function notifyShiftChangeAsync(userId, oldShiftDefId, newCode, shiftDate, stationId, actor, req) {
  try {
    const [user, oldDef] = await Promise.all([
      userRepo.findById(userId),
      oldShiftDefId ? rosterRepo.findShiftDefById(oldShiftDefId) : null,
    ]);
    if (!user) return;
    await notificationService.notifyShiftChanged(user, { shiftDate, oldCode: oldDef?.code || null, newCode });
  } catch (err) {
    await auditTrail.logActivity("Notification error", `Shift change alert: ${err.message}`, stationId, actor, req);
  }
}

// Single-cell shift edit — this IS the "notify on any roster change" choke
// point from the original spec: one function, called by both the single
// and bulk endpoints, that both writes the audit trail entry and will be
// where Module 4 fires the change-alert email/WhatsApp.
async function upsertShift({ stationId, monthKey, userId, shiftDate, shiftCode, note, reason }, actor, req) {
  const roster = await getOrCreateRoster(stationId, monthKey, actor);
  if (roster.isPublished) {
    throw ApiError.forbidden("Roster is published — republish is required after further edits, or contact an admin to unpublish");
  }

  const shiftDef = await rosterRepo.findShiftDefByCode(shiftCode);
  if (!shiftDef) throw ApiError.badRequest(`Unknown shift code: ${shiftCode}`);

  const dateObj = new Date(shiftDate + "T00:00:00.000Z");
  const before = await rosterRepo.findAssignment(roster.id, userId, dateObj);

  const updated = await rosterRepo.upsertAssignment({
    rosterId: roster.id, userId, shiftDate: dateObj, shiftDefId: shiftDef.id, note, actorId: actor.sub,
  });

  const changed = !before || before.shiftDefId !== shiftDef.id;
  if (changed) {
    await auditTrail.recordUpdate(
      "ShiftAssignment", updated.id, stationId,
      { shiftDefId: before?.shiftDefId || "—" },
      { shiftDefId: shiftDef.id },
      actor, req, reason
    );

    // The actual "notify on any roster change" requirement — email AND
    // WhatsApp, fired only when the value genuinely changed (see the check
    // above), never on a no-op save. Runs after the response-critical work
    // above; failures are logged, never thrown back at the caller.
    notifyShiftChangeAsync(userId, before?.shiftDefId, shiftDef.code, shiftDate, stationId, actor, req);
  }

  return { assignment: updated, changed, shiftCode: shiftDef.code, previousShiftDefId: before?.shiftDefId || null };
}

async function bulkUpsertShifts({ stationId, monthKey, assignments }, actor, req) {
  const roster = await getOrCreateRoster(stationId, monthKey, actor);
  if (roster.isPublished) {
    throw ApiError.forbidden("Roster is published — unpublish before bulk-editing");
  }

  const shiftDefs = await rosterRepo.findAllShiftDefs();
  const codeToId = Object.fromEntries(shiftDefs.map(d => [d.code, d.id]));

  const unknownCodes = assignments.map(a => a.shiftCode).filter(c => !codeToId[c]);
  if (unknownCodes.length) throw ApiError.badRequest(`Unknown shift codes: ${[...new Set(unknownCodes)].join(", ")}`);

  const rows = assignments.map(a => ({
    rosterId: roster.id, userId: a.userId,
    shiftDate: new Date(a.shiftDate + "T00:00:00.000Z"),
    shiftDefId: codeToId[a.shiftCode], note: a.note, actorId: actor.sub,
  }));

  const results = await rosterRepo.bulkUpsertAssignments(rows);
  await auditTrail.logActivity("Bulk roster update", `${stationId} — ${monthKey}: ${results.length} shifts`, stationId, actor, req);
  // Field-level diffing for each of potentially hundreds of cells is
  // deliberately skipped here — the single activity-log entry above is what
  // a generated-roster "apply" should produce. Manual edits go through
  // upsertShift above (one at a time), which DOES record per-cell history.

  return { count: results.length };
}

function listShiftDefinitions() {
  return rosterRepo.findAllShiftDefs();
}

function listRostersForStation(stationId) {
  return rosterRepo.listRostersForStation(stationId);
}

module.exports = { getRosterGrid, publishRoster, unpublishRoster, upsertShift, bulkUpsertShifts, listShiftDefinitions, listRostersForStation };
