// Holiday is deliberately purely informational for now — shown to staff and
// managers on the calendar/leave screens, but NOT read by
// rosterGenerationAlgorithm.js, so it adds zero risk to the already-working
// generation engine. Whether a holiday should also lighten advisory-tier
// staffing targets is a real, separate design question — flagged for the
// user to confirm, not silently assumed either way.
const holidayRepo = require("../repositories/holidayRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const { assertOwnStation, isAirlineWide, isSuperAdmin, resolveAirlineId } = require("../utils/stationScope");

function toDateOnly(iso) { return new Date(iso + "T00:00:00.000Z"); }

async function listHolidays(actor, { stationId, from, to, page, pageSize }) {
  let targetStationId = stationId;
  if (targetStationId) await assertOwnStation(actor, targetStationId);
  else if (!isAirlineWide(actor)) targetStationId = actor.stationId;

  const airlineId = await resolveAirlineId(actor, targetStationId || actor.stationId);
  return holidayRepo.list({
    airlineId, stationId: targetStationId,
    from: from ? toDateOnly(from) : undefined,
    to: to ? toDateOnly(to) : undefined,
    page, pageSize,
  });
}

async function createHoliday(body, actor, req) {
  let stationId = body.stationId || null;
  if (stationId) {
    await assertOwnStation(actor, stationId);
  } else if (!isAirlineWide(actor)) {
    // A station-scoped manager creating without naming a station means
    // "for my own station" — only an Airline Admin (or Super Admin) can
    // actually create an airline-wide entry.
    stationId = actor.stationId;
  }
  const airlineId = await resolveAirlineId(actor, stationId || actor.stationId);
  const holiday = await holidayRepo.create({
    airlineId, stationId, date: toDateOnly(body.date), name: body.name, actorId: actor.sub,
  });
  await auditTrail.recordCreate("Holiday", holiday.id, stationId, actor, req);
  await auditTrail.logActivity(
    "Holiday added", `${body.name} (${body.date})${stationId ? "" : " — airline-wide"}`, stationId, actor, req
  );
  return holiday;
}

function assertCanManage(actor, holiday) {
  if (isSuperAdmin(actor)) return Promise.resolve();
  if (holiday.stationId) return assertOwnStation(actor, holiday.stationId);
  if (!isAirlineWide(actor) || holiday.airlineId !== actor.airlineId) {
    throw ApiError.notFound("Holiday not found");
  }
  return Promise.resolve();
}

async function updateHoliday(id, body, actor, req) {
  const existing = await holidayRepo.findById(id);
  if (!existing) throw ApiError.notFound("Holiday not found");
  await assertCanManage(actor, existing);

  const updated = await holidayRepo.update(id, {
    date: body.date ? toDateOnly(body.date) : undefined,
    name: body.name,
  }, actor.sub);

  await auditTrail.recordUpdate(
    "Holiday", id, existing.stationId,
    { name: existing.name, date: existing.date },
    { name: updated.name, date: updated.date },
    actor, req
  );
  return updated;
}

async function deleteHoliday(id, actor, req) {
  const existing = await holidayRepo.findById(id);
  if (!existing) throw ApiError.notFound("Holiday not found");
  await assertCanManage(actor, existing);

  await holidayRepo.softDelete(id, actor.sub);
  await auditTrail.recordDelete("Holiday", id, existing.stationId, actor, req);
  await auditTrail.logActivity("Holiday removed", existing.name, existing.stationId, actor, req);
}

module.exports = { listHolidays, createHoliday, updateHoliday, deleteHoliday };
