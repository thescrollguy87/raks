const prisma = require("../config/prisma");

// ─── Staff Groups ─────────────────────────────────────────────────────────────
function listStaffGroups(stationId) {
  return prisma.staffGroup.findMany({
    where: { stationId },
    include: { members: { include: { user: { select: { id: true, fullName: true, category: true } } } } },
    orderBy: { name: "asc" },
  });
}

function findStaffGroup(id) {
  return prisma.staffGroup.findUnique({ where: { id } });
}

// Full-replace semantics: the Staff Groups editor always submits the
// complete member list for a group, so the simplest correct operation is
// "clear then re-add" rather than diffing — a group's membership is small
// (a handful to a few dozen staff) and changed as a whole from the UI, not
// incrementally.
async function upsertStaffGroup({ id, stationId, name, memberUserIds }) {
  if (id) {
    await prisma.workloadRuleStaffGroupMember.deleteMany({ where: { staffGroupId: id } });
    return prisma.staffGroup.update({
      where: { id },
      data: {
        name,
        members: { create: (memberUserIds || []).map(userId => ({ userId })) },
      },
      include: { members: { include: { user: { select: { id: true, fullName: true, category: true } } } } },
    });
  }
  return prisma.staffGroup.create({
    data: {
      stationId, name,
      members: { create: (memberUserIds || []).map(userId => ({ userId })) },
    },
    include: { members: { include: { user: { select: { id: true, fullName: true, category: true } } } } },
  });
}

function deleteStaffGroup(id) {
  return prisma.staffGroup.delete({ where: { id } }); // cascades to members
}

// ─── Workload Rules ───────────────────────────────────────────────────────────
function listRules(stationId) {
  return prisma.workloadRule.findMany({ where: { stationId }, orderBy: [{ type: "asc" }, { priority: "asc" }] });
}

function findRule(id) {
  return prisma.workloadRule.findUnique({ where: { id } });
}

function upsertRule({ id, stationId, ...fields }) {
  if (id) return prisma.workloadRule.update({ where: { id }, data: fields });
  return prisma.workloadRule.create({ data: { stationId, ...fields } });
}

function deleteRule(id) {
  return prisma.workloadRule.delete({ where: { id } });
}

module.exports = {
  listStaffGroups, findStaffGroup, upsertStaffGroup, deleteStaffGroup,
  listRules, findRule, upsertRule, deleteRule,
};
