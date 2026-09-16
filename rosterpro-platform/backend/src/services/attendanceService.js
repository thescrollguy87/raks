// Punch-in/out, distance-to-geofence, and the roster-driven "does this day
// even need a punch" exemption logic (spec requirement: a deputation-coded
// or leave day should never be flagged as a missing punch — the roster
// already explains it). Reuses the exact same duty/night check the
// dashboard already uses (dashboardService.js) rather than inventing a
// second "is this person on duty" concept.
const attendanceRepo = require("../repositories/attendanceRepository");
const officeLocationRepo = require("../repositories/officeLocationRepository");
const userRepo = require("../repositories/userRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const { rankLocationsByDistance, looksLikeMockLocation } = require("../utils/geo");

// Grace windows are deliberately simple flat constants — no per-station
// config was asked for in this pass, and a fixed 10-minute grace before
// "late"/"early" is a reasonable operational default. Easy to promote to a
// per-station setting later (same shape as StationWorkloadConfig) without
// changing anything else here.
const LATE_GRACE_MINUTES = 10;
const EARLY_OUT_GRACE_MINUTES = 10;

// PHOTO STORAGE NOTE: there is no S3/file-storage integration anywhere in
// this backend today (the Attachment model is schema-only scaffolding —
// see repositories/attendanceRepository.js's neighbors for the only real
// upload pattern in this app, which is transient multer buffers for Excel
// imports, never persisted). Storing the punch photo as a compressed JPEG
// directly in Postgres (Bytes column) is a deliberate, flagged choice for
// this phase — small, timestamped audit photos, not a media library — and
// is a straightforward later swap for an s3Key once that integration
// exists, without touching any of the logic below.
const MAX_PHOTO_BYTES = 400 * 1024; // ~400KB — a compressed selfie, not a full-res photo

function isExemptShiftType(type) {
  // Mirrors dashboardService.js's own "on duty" check exactly: duty/night
  // means physically required on station; everything else (leave, off,
  // deputation/training/other) is a day the roster already explains.
  return !!type && type !== "duty" && type !== "night";
}

function toDateOnly(d) {
  const iso = typeof d === "string" ? d : d.toISOString();
  return new Date(iso.slice(0, 10) + "T00:00:00.000Z");
}

// ShiftDefinition.startTime/endTime are station-local wall-clock strings
// (this app is India-only so far — a fixed UTC+5:30, no DST, same
// assumption jobs/scheduledJobs.js makes with env.tz) — NOT bare UTC, so a
// naive setUTCHours(h, m, ...) would compare a punch against the wrong
// instant by 5.5 hours. setUTCHours' minutes argument accepts values
// outside 0-59 and normalizes across hour/day boundaries, which is exactly
// what correctly rolls a shift starting just after IST midnight back onto
// the previous UTC day.
const IST_OFFSET_MINUTES = 330;
function parseTimeOnDate(date, hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(date);
  d.setUTCHours(0, h * 60 + m - IST_OFFSET_MINUTES, 0, 0);
  return d;
}

function minutesBetween(a, b) {
  return (a.getTime() - b.getTime()) / 60000;
}

function decodePhoto(photoBase64) {
  if (!photoBase64) return { buffer: null, mime: null };
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(photoBase64);
  const mime = match ? match[1] : "image/jpeg";
  const raw = match ? match[2] : photoBase64;
  const buffer = Buffer.from(raw, "base64");
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw ApiError.badRequest(`Photo is too large (${Math.round(buffer.length / 1024)}KB) — please compress before uploading.`);
  }
  return { buffer, mime };
}

async function resolveDistance(stationId, lat, lng) {
  const locations = await officeLocationRepo.listActiveForStation(stationId);
  if (!locations.length) {
    throw ApiError.badRequest("No office locations are configured for your station yet — ask your Station Manager to add one before punching in.");
  }
  const ranked = rankLocationsByDistance(lat, lng, locations);
  return { nearest: ranked[0], all: ranked };
}

async function getTodayContext(actor) {
  if (!actor.stationId) throw ApiError.badRequest("Your account has no station assigned — attendance punching isn't available.");
  const today = toDateOnly(new Date());
  const [scheduledShift, record, locations] = await Promise.all([
    attendanceRepo.findScheduledShift(actor.sub, actor.stationId, today),
    attendanceRepo.findByUserAndDate(actor.sub, today),
    officeLocationRepo.listActiveForStation(actor.stationId),
  ]);
  return {
    date: today.toISOString().slice(0, 10),
    scheduledShift: scheduledShift?.shiftDef || null,
    exempt: isExemptShiftType(scheduledShift?.shiftDef?.type),
    record,
    officeLocations: locations.map(l => ({ id: l.id, name: l.name, latitude: l.latitude, longitude: l.longitude, radiusMeters: l.radiusMeters })),
  };
}

async function punchIn(body, actor, req) {
  if (!actor.stationId) throw ApiError.badRequest("Your account has no station assigned — attendance punching isn't available.");
  const capturedAt = new Date(body.capturedAt);
  if (Number.isNaN(capturedAt.getTime())) throw ApiError.badRequest("capturedAt must be a valid timestamp");
  const date = toDateOnly(capturedAt);

  const existing = await attendanceRepo.findByUserAndDate(actor.sub, date);
  if (existing?.punchInAt) throw ApiError.conflict("You've already punched in today.");

  const { nearest } = await resolveDistance(actor.stationId, body.lat, body.lng);
  const mockSuspected = looksLikeMockLocation({ accuracy: body.accuracy, nearestDistanceM: nearest.distanceM });
  if (mockSuspected) {
    throw ApiError.forbidden("This location looks like it may be simulated/mocked rather than a real GPS reading. Punch rejected — try again with real location services, or contact your manager if this keeps happening.");
  }
  if (nearest.distanceM > nearest.location.radiusMeters) {
    throw ApiError.forbidden(`You're ${Math.round(nearest.distanceM)}m from ${nearest.location.name} (needs to be within ${nearest.location.radiusMeters}m). Move closer and try again.`);
  }

  const scheduled = await attendanceRepo.findScheduledShift(actor.sub, actor.stationId, date);
  const shiftDef = scheduled?.shiftDef;
  let status = "ON_TIME";
  if (shiftDef && !isExemptShiftType(shiftDef.type) && shiftDef.startTime) {
    const scheduledStart = parseTimeOnDate(date, shiftDef.startTime);
    if (minutesBetween(capturedAt, scheduledStart) > LATE_GRACE_MINUTES) status = "LATE";
  }

  const { buffer: photo, mime: photoMime } = decodePhoto(body.photoBase64);

  const data = {
    userId: actor.sub, stationId: actor.stationId, date,
    scheduledShiftDefId: scheduled?.shiftDefId || null,
    scheduledShiftCode: shiftDef?.code || null,
    scheduledStartTime: shiftDef?.startTime || null,
    scheduledEndTime: shiftDef?.endTime || null,
    punchInAt: capturedAt, punchInSyncedAt: new Date(),
    punchInLat: body.lat, punchInLng: body.lng, punchInAccuracy: body.accuracy ?? null,
    punchInDistanceM: nearest.distanceM, punchInLocationId: nearest.location.id,
    punchInPhoto: photo, punchInPhotoMime: photoMime,
    punchInDevice: (req?.headers?.["user-agent"] || "").slice(0, 300),
    punchInMockSuspected: mockSuspected,
    status,
  };

  const record = existing
    ? await attendanceRepo.update(existing.id, data)
    : await attendanceRepo.create(data);

  await auditTrail.logActivity(
    "Punched in", `${date.toISOString().slice(0, 10)} — ${Math.round(nearest.distanceM)}m from ${nearest.location.name}${status === "LATE" ? " (late)" : ""}`,
    actor.stationId, actor, req
  );
  return record;
}

async function punchOut(body, actor, req) {
  if (!actor.stationId) throw ApiError.badRequest("Your account has no station assigned — attendance punching isn't available.");
  const capturedAt = new Date(body.capturedAt);
  if (Number.isNaN(capturedAt.getTime())) throw ApiError.badRequest("capturedAt must be a valid timestamp");
  const date = toDateOnly(capturedAt);

  let existing = await attendanceRepo.findByUserAndDate(actor.sub, date);
  if (existing?.punchOutAt) throw ApiError.conflict("You've already punched out today.");

  const { nearest } = await resolveDistance(actor.stationId, body.lat, body.lng);
  const mockSuspected = looksLikeMockLocation({ accuracy: body.accuracy, nearestDistanceM: nearest.distanceM });
  if (mockSuspected) {
    throw ApiError.forbidden("This location looks like it may be simulated/mocked rather than a real GPS reading. Punch rejected — try again with real location services, or contact your manager if this keeps happening.");
  }
  if (nearest.distanceM > nearest.location.radiusMeters) {
    throw ApiError.forbidden(`You're ${Math.round(nearest.distanceM)}m from ${nearest.location.name} (needs to be within ${nearest.location.radiusMeters}m). Move closer and try again.`);
  }

  const { buffer: photo, mime: photoMime } = decodePhoto(body.photoBase64);

  let status = existing?.status || "MISSING"; // punching out with no punch-in on file leaves the missing-in flag visible, not silently overwritten
  if (existing?.punchInAt) {
    const scheduled = await attendanceRepo.findScheduledShift(actor.sub, actor.stationId, date);
    const shiftDef = scheduled?.shiftDef;
    if (shiftDef && !isExemptShiftType(shiftDef.type) && shiftDef.endTime) {
      const scheduledEnd = parseTimeOnDate(date, shiftDef.endTime);
      if (minutesBetween(scheduledEnd, capturedAt) > EARLY_OUT_GRACE_MINUTES) status = "EARLY_OUT";
    }
  }

  const data = {
    punchOutAt: capturedAt, punchOutSyncedAt: new Date(),
    punchOutLat: body.lat, punchOutLng: body.lng, punchOutAccuracy: body.accuracy ?? null,
    punchOutDistanceM: nearest.distanceM, punchOutLocationId: nearest.location.id,
    punchOutPhoto: photo, punchOutPhotoMime: photoMime,
    punchOutDevice: (req?.headers?.["user-agent"] || "").slice(0, 300),
    punchOutMockSuspected: mockSuspected,
    status,
  };

  const record = existing
    ? await attendanceRepo.update(existing.id, data)
    : await attendanceRepo.create({
        userId: actor.sub, stationId: actor.stationId, date, status: "MISSING", ...data,
      });

  await auditTrail.logActivity(
    "Punched out", `${date.toISOString().slice(0, 10)} — ${Math.round(nearest.distanceM)}m from ${nearest.location.name}${status === "EARLY_OUT" ? " (early)" : ""}`,
    actor.stationId, actor, req
  );
  return record;
}

function listRecords(query) {
  const params = { ...query };
  if (params.from) params.from = toDateOnly(params.from);
  if (params.to) params.to = toDateOnly(params.to);
  return attendanceRepo.list(params);
}

// Day-by-day picture for one person over a range — the "My Attendance"
// view's data source, and reused by the monthly register report. Purely
// computed at read time: a day nobody's punched simply has no
// AttendanceRecord row (see punchIn/punchOut above — rows are created lazily,
// never pre-seeded by a job), so "missing" here means "duty/night was
// scheduled, no row exists, and no regularization has been approved for it".
async function buildDailyOverview(userId, stationId, from, to) {
  const fromDate = toDateOnly(from);
  const toDateEnd = toDateOnly(to);
  const [records, shifts] = await Promise.all([
    attendanceRepo.list({ userId, stationId, from: fromDate, to: toDateEnd, pageSize: 100 }).then(r => r.items),
    attendanceRepo.findScheduledShiftsForRange(userId, stationId, fromDate, toDateEnd),
  ]);
  const recordByDate = new Map(records.map(r => [r.date.toISOString().slice(0, 10), r]));
  const shiftByDate = new Map(shifts.map(s => [s.shiftDate.toISOString().slice(0, 10), s.shiftDef]));

  const days = [];
  const cursor = new Date(fromDate);
  const today = toDateOnly(new Date());
  while (cursor <= toDateEnd) {
    const iso = cursor.toISOString().slice(0, 10);
    const shiftDef = shiftByDate.get(iso) || null;
    const record = recordByDate.get(iso) || null;
    const exempt = isExemptShiftType(shiftDef?.type);
    const isPast = cursor < today;
    const needsRegularization =
      !exempt && !!shiftDef && isPast && (!record || !record.punchInAt) &&
      !(record?.regularizationRequests?.[0] && record.regularizationRequests[0].status !== "REJECTED" && record.regularizationRequests[0].status !== "CANCELLED");
    days.push({ date: iso, scheduledShift: shiftDef, exempt, record, needsRegularization });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

module.exports = {
  isExemptShiftType, getTodayContext, punchIn, punchOut, listRecords, buildDailyOverview,
};
