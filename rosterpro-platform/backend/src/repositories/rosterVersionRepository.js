const prisma = require("../config/prisma");

function findRosterById(id) {
  return prisma.roster.findUnique({ where: { id } });
}

// Live ShiftAssignment rows for a roster, shaped as version-item data —
// shiftCode is denormalized off the current shiftDef so the snapshot stays
// readable even if that code is later renamed/deactivated. `client` lets
// callers pass a transaction handle (`tx`) when this needs to be read
// consistently alongside writes in the same transaction (restoreVersion).
async function liveSnapshotItems(rosterId, client = prisma) {
  const rows = await client.shiftAssignment.findMany({
    where: { rosterId, deletedAt: null },
    include: { shiftDef: { select: { code: true } } },
  });
  return rows.map(a => ({
    userId: a.userId, shiftDate: a.shiftDate, shiftDefId: a.shiftDefId, shiftCode: a.shiftDef.code,
    note: a.note, in1: a.in1, out1: a.out1, in2: a.in2, out2: a.out2,
  }));
}

async function nextVersionNumber(rosterId, client = prisma) {
  const agg = await client.rosterVersion.aggregate({ where: { rosterId }, _max: { versionNumber: true } });
  return (agg._max.versionNumber || 0) + 1;
}

function createVersion({ rosterId, versionNumber, reason, isPublishedSnapshot, restoredFromVersionId, createdById, createdByName, items }, client = prisma) {
  return client.rosterVersion.create({
    data: {
      rosterId, versionNumber, reason: reason || null, isPublishedSnapshot: !!isPublishedSnapshot,
      restoredFromVersionId: restoredFromVersionId || null,
      createdById: createdById || null, createdByName: createdByName || "System",
      items: { create: items },
    },
  });
}

function listVersionsForRoster(rosterId) {
  return prisma.rosterVersion.findMany({
    where: { rosterId },
    orderBy: { versionNumber: "desc" },
    include: { _count: { select: { items: true } } },
  });
}

function findVersionWithItemsAndRoster(versionId) {
  return prisma.rosterVersion.findUnique({
    where: { id: versionId },
    include: { items: true, roster: { select: { id: true, stationId: true, monthKey: true } } },
  });
}

// Overwrites the live grid to match `items` exactly — used only by restore,
// always inside the same transaction as the two version-history rows it's
// paired with, so a failure partway never leaves history and live state
// out of sync with each other.
async function replaceLiveAssignments(rosterId, items, actorId, client = prisma) {
  await client.shiftAssignment.deleteMany({ where: { rosterId } });
  if (items.length) {
    await client.shiftAssignment.createMany({
      data: items.map(i => ({
        rosterId, userId: i.userId, shiftDate: i.shiftDate, shiftDefId: i.shiftDefId,
        note: i.note, in1: i.in1, out1: i.out1, in2: i.in2, out2: i.out2,
        createdById: actorId || null, updatedById: actorId || null,
      })),
    });
  }
}

function runTransaction(fn) {
  return prisma.$transaction(fn);
}

module.exports = {
  findRosterById, liveSnapshotItems, nextVersionNumber, createVersion, listVersionsForRoster,
  findVersionWithItemsAndRoster, replaceLiveAssignments, runTransaction,
};
