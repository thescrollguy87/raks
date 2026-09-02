const rosterRepo = require("../repositories/rosterRepository");
const planningRepo = require("../repositories/rosterPlanningRepository");
const userRepo = require("../repositories/userRepository");
const complianceService = require("./complianceService");
const auditTrail = require("../utils/auditTrail");
const ApiError = require("../utils/ApiError");
const { assertOwnStation } = require("../utils/stationScope");
const { parseCycle } = require("../utils/shiftPatternCycle");
const { computeManpowerPlan } = require("../utils/manpowerPlanning");

// ─── Shift Definitions (single-row CRUD — the Excel import/export pair in
// shiftDefinitionService.js already covers bulk, this covers the Shift
// Definitions tab's inline add/edit/delete-a-row flow) ───────────────────────
async function upsertShiftDefinition(input, actor, req) {
  const def = await rosterRepo.upsertShiftDef(actor.airlineId, input);
  await auditTrail.logActivity("Shift definition saved", `${def.code} — ${def.name}`, null, actor, req);
  return def;
}

async function deactivateShiftDefinition(id, actor, req) {
  const def = await rosterRepo.findShiftDefById(actor.airlineId, id);
  if (!def) throw ApiError.notFound("Shift definition not found");
  const updated = await rosterRepo.deactivateShiftDef(actor.airlineId, id);
  await auditTrail.logActivity("Shift definition removed", `${def.code} — ${def.name}`, null, actor, req);
  return updated;
}

// ─── Shift Patterns ───────────────────────────────────────────────────────────
function listPatterns(stationId) {
  return planningRepo.findPatternsForStation(stationId);
}

async function upsertPattern(input, actor, req) {
  const pattern = await planningRepo.upsertPattern({ ...input, actorId: actor.sub });
  await auditTrail.logActivity("Shift pattern saved", `${pattern.code} — ${pattern.name} (${pattern.cycle})`, pattern.stationId, actor, req);
  return pattern;
}

async function deletePattern(id, actor, req) {
  const pattern = await planningRepo.findPatternById(id);
  if (!pattern) throw ApiError.notFound("Shift pattern not found");
  await assertOwnStation(actor, pattern.stationId);
  const deleted = await planningRepo.deletePattern(id);
  await auditTrail.logActivity("Shift pattern removed", `${pattern.code} — ${pattern.name}`, pattern.stationId, actor, req);
  return deleted;
}

// ─── Staff Allocation ─────────────────────────────────────────────────────────
// Every active staff member at the station, each merged with their
// allocation row if one exists — a staff member with none shown as
// MANUAL/no-pattern, matching the Staff Allocation tab's full roster table
// (it lists everyone, not just the already-configured).
async function listAllocations(stationId) {
  const [staff, allocations] = await Promise.all([
    rosterRepo.getActiveStaffForGeneration(stationId),
    planningRepo.findAllocationsForStation(stationId),
  ]);
  const byUserId = new Map(allocations.map(a => [a.userId, a]));
  return staff.map(s => {
    const alloc = byUserId.get(s.id);
    return {
      userId: s.id, fullName: s.fullName, category: s.category,
      patternId: alloc?.patternId || null,
      patternCode: alloc?.pattern?.code || null,
      cycleStartDay: alloc?.cycleStartDay ?? 0,
    };
  });
}

async function upsertAllocation(input, actor, req) {
  const target = await userRepo.findStationId(input.userId);
  if (!target) throw ApiError.notFound("Staff member not found");
  await assertOwnStation(actor, target.stationId);
  const alloc = await planningRepo.upsertAllocation({ ...input, actorId: actor.sub });
  await auditTrail.logActivity("Staff shift allocation saved", `userId ${input.userId} -> pattern ${input.patternId || "MANUAL"}`, null, actor, req);
  return alloc;
}

// ─── Workload Items ───────────────────────────────────────────────────────────
function listWorkloadItems(stationId) {
  return planningRepo.findWorkloadItemsForStation(stationId);
}

async function upsertWorkloadItem(input, actor, req) {
  const item = await planningRepo.upsertWorkloadItem({ ...input, actorId: actor.sub });
  await auditTrail.logActivity("Workload item saved", `${item.section} — ${item.label}`, item.stationId, actor, req);
  return item;
}

async function deleteWorkloadItem(id, actor, req) {
  const item = await planningRepo.findWorkloadItemById(id);
  if (!item) throw ApiError.notFound("Workload item not found");
  await assertOwnStation(actor, item.stationId);
  const deleted = await planningRepo.deleteWorkloadItem(id);
  await auditTrail.logActivity("Workload item removed", `${item.section} — ${item.label}`, item.stationId, actor, req);
  return deleted;
}

// ─── Manpower Plan (Generate tab's "Calculate" step) ─────────────────────────
function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

async function getManpowerPlan(stationId, monthKey, aogBuffer = 2) {
  const [workloadItems, staff] = await Promise.all([
    planningRepo.findWorkloadItemsForStation(stationId),
    rosterRepo.getActiveStaffForGeneration(stationId),
  ]);
  const summaries = await Promise.all(staff.map(s => complianceService.getComplianceSummary(s.id)));
  const blockedIds = new Set(staff.filter((s, i) => summaries[i].isBlocked).map(s => s.id));

  const staffByCategory = {};
  for (const s of staff) {
    if (blockedIds.has(s.id)) continue;
    const cat = s.category || "NCS";
    staffByCategory[cat] = (staffByCategory[cat] || 0) + 1;
  }

  return computeManpowerPlan({
    workloadItems, daysInMon: daysInMonth(monthKey), aogBuffer,
    staffByCategory, totalStaff: staff.length, blockedCount: blockedIds.size,
  });
}

module.exports = {
  upsertShiftDefinition, deactivateShiftDefinition,
  listPatterns, upsertPattern, deletePattern,
  listAllocations, upsertAllocation,
  listWorkloadItems, upsertWorkloadItem, deleteWorkloadItem,
  getManpowerPlan,
  parseCycle,
};
