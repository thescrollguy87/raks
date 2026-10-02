// ═══════════════════════════════════════════════════════════════════════════
// TASK ALLOCATION MODULE — read-only adapter onto the EXISTING Rostering
// module. Every function here is READ-ONLY and calls an already-exported
// function from the existing roster/leave/compliance services/repositories
// — never a raw query against their tables, and never a reimplementation of
// their logic. Zero lines of any existing file were changed to build this.
// See the "EXISTING CODE ABOVE / NEW CODE BELOW" banner in schema.prisma for
// the same isolation principle applied to the data layer.
// ═══════════════════════════════════════════════════════════════════════════
const rosterRepo = require("../repositories/rosterRepository");
const leaveRepo = require("../repositories/leaveRepository");
const complianceService = require("./complianceService");

function dateKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function monthKeyOf(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Section 6: Task Allocation's staff source is the PUBLISHED Roster for the
// requested date, and ONLY the published one — a draft/in-progress roster
// is never read here, since Task Allocation must never race against someone
// still editing next month's roster. Returns null when no PUBLISHED roster
// exists for that date's month.
async function getPublishedRosterStatus(stationId, date) {
  const monthKey = monthKeyOf(date);
  const roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  if (!roster || !roster.isPublished) return null;
  return { rosterId: roster.id, monthKey, isPublished: true, publishedAt: roster.publishedAt, lastSyncedAt: new Date() };
}

// Everyone rostered to a real DUTY/NIGHT shift (not O/L/G/other) on the
// given date, per the published roster — the "who is available" population
// the Task Board header (Section 6) and the Eligibility Engine both start
// from. Each row carries exactly what the eligibility/scoring engines need:
// category, the real shift window (falling back to the shift definition's
// own start/end when no per-day override exists — same convention
// shiftHours.js already uses for manhours), and trainingPending/
// secondaryCategories so a training-pending or dual-qualified person is
// handled consistently with how Rostering itself treats them.
async function getRosteredStaffForDate(stationId, date) {
  const status = await getPublishedRosterStatus(stationId, date);
  if (!status) return { isPublished: false, rosterId: null, staff: [] };

  const grid = await rosterRepo.getRosterGrid(stationId, status.rosterId);
  const key = dateKey(date);
  const staff = [];
  for (const s of grid) {
    const sa = s.shiftAssignments.find(a => dateKey(a.shiftDate) === key);
    if (!sa || !sa.shiftDef) continue;
    if (sa.shiftDef.type !== "duty" && sa.shiftDef.type !== "night") continue; // O/L/G/other never count as "on duty"
    staff.push({
      userId: s.id,
      fullName: s.fullName,
      category: s.category,
      trainingPending: s.trainingPending,
      secondaryCategories: s.secondaryCategories || [],
      shiftCode: sa.shiftDef.code,
      shiftType: sa.shiftDef.type,
      shiftStart: sa.in1 || sa.shiftDef.startTime,
      shiftEnd: sa.out2 || sa.out1 || sa.shiftDef.endTime,
    });
  }
  return { isPublished: true, rosterId: status.rosterId, staff };
}

// Section 6's summary counts ("B1 available: 5", ...) — a thin aggregation
// over getRosteredStaffForDate, never a separate query.
async function getAvailabilitySummary(stationId, date) {
  const { isPublished, rosterId, staff } = await getRosteredStaffForDate(stationId, date);
  const byCategory = {};
  for (const s of staff) byCategory[s.category || "UNCATEGORIZED"] = (byCategory[s.category || "UNCATEGORIZED"] || 0) + 1;
  return { isPublished, rosterId, totalAvailable: staff.length, byCategory };
}

// Whether `userId` is on APPROVED leave on `date` — reuses the exact same
// leave repository query the roster generator itself uses, scoped to a
// single day instead of a month range.
async function isOnApprovedLeave(userId, date) {
  const d = new Date(date);
  const leaves = await leaveRepo.approvedLeaveForStaffInRange([userId], d, d);
  return leaves.length > 0;
}

// Bulk variant for the Eligibility Engine scanning many candidates at
// once — one query instead of N, same underlying leave repository call.
async function getLeaveSetForDate(userIds, date) {
  if (!userIds.length) return new Set();
  const d = new Date(date);
  const leaves = await leaveRepo.approvedLeaveForStaffInRange(userIds, d, d);
  return new Set(leaves.map(l => l.userId));
}

// Full qualification/license/training/authorization picture for one staff
// member — delegates entirely to complianceService.getComplianceSummary,
// the SAME function the Qualifications page and roster generation's
// blocked-staff check already use, so "is this person qualified/blocked"
// can never silently disagree between Rostering and Task Allocation.
async function getQualificationProfile(userId) {
  return complianceService.getComplianceSummary(userId);
}

// Bulk blocked-staff lookup for scanning many eligibility candidates at
// once — reuses complianceService.getBlockedStaffMap (the same bulk query
// the Shift Roster grid uses) rather than N individual calls.
async function getBlockedStaffMap(stationId) {
  return complianceService.getBlockedStaffMap(stationId);
}

// { userId -> fullName } for a station — TaskAssignment.userId deliberately
// carries no Prisma relation to User (see schema.prisma's module banner),
// so the Task Board/History UI needs this separate, explicit lookup to show
// a name instead of a raw id. Reuses rosterRepo.getActiveStaffContacts (the
// same query roster-wide notifications already use) rather than a new raw
// query.
async function getStaffNameMap(stationId) {
  const staff = await rosterRepo.getActiveStaffContacts(stationId);
  return Object.fromEntries(staff.map(s => [s.id, s.fullName]));
}

module.exports = {
  getPublishedRosterStatus, getRosteredStaffForDate, getAvailabilitySummary,
  isOnApprovedLeave, getLeaveSetForDate, getQualificationProfile, getBlockedStaffMap, getStaffNameMap,
};
