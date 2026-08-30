const repo = require("../repositories/ruleBuilderRepository");
const auditTrail = require("../utils/auditTrail");
const ApiError = require("../utils/ApiError");
const { assertOwnStation } = require("../utils/stationScope");

// ─── Staff Groups ─────────────────────────────────────────────────────────────
function listStaffGroups(stationId) {
  return repo.listStaffGroups(stationId);
}

async function upsertStaffGroup(input, actor, req) {
  assertOwnStation(actor, input.stationId);
  const group = await repo.upsertStaffGroup(input);
  await auditTrail.logActivity("Staff group saved", `${group.name} (${group.members.length} member(s))`, input.stationId, actor, req);
  return group;
}

async function deleteStaffGroup(id, actor, req) {
  const group = await repo.findStaffGroup(id);
  if (!group) throw ApiError.notFound("Staff group not found");
  assertOwnStation(actor, group.stationId);
  await repo.deleteStaffGroup(id);
  await auditTrail.logActivity("Staff group removed", group.name, group.stationId, actor, req);
  return { id };
}

// Lookups consumed by generation/scoring (ruleEngine.js's
// resolveRuleStaffScope / ruleAppliesToStaff / appliesToLabel), keeping the
// "group id -> member ids / display name" shaping in one place rather than
// re-deriving it at every call site.
async function getStaffGroupMembersByGroupId(stationId) {
  const groups = await repo.listStaffGroups(stationId);
  const byGroupId = {};
  groups.forEach(g => { byGroupId[g.id] = g.members.map(m => m.userId); });
  return byGroupId;
}

async function getStaffGroupNameById(stationId) {
  const groups = await repo.listStaffGroups(stationId);
  const byId = {};
  groups.forEach(g => { byId[g.id] = g.name; });
  return byId;
}

// ─── Workload Rules ───────────────────────────────────────────────────────────
function listRules(stationId) {
  return repo.listRules(stationId);
}

async function upsertRule(input, actor, req) {
  assertOwnStation(actor, input.stationId);
  const rule = await repo.upsertRule(input);
  await auditTrail.logActivity("Workload rule saved", `${rule.name} (${rule.type}/${rule.conditionType})`, input.stationId, actor, req);
  return rule;
}

async function deleteRule(id, actor, req) {
  const rule = await repo.findRule(id);
  if (!rule) throw ApiError.notFound("Workload rule not found");
  assertOwnStation(actor, rule.stationId);
  await repo.deleteRule(id);
  await auditTrail.logActivity("Workload rule removed", rule.name, rule.stationId, actor, req);
  return { id };
}

module.exports = {
  listStaffGroups, upsertStaffGroup, deleteStaffGroup,
  getStaffGroupMembersByGroupId, getStaffGroupNameById,
  listRules, upsertRule, deleteRule,
};
