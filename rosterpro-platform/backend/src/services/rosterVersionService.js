const rosterVersionRepo = require("../repositories/rosterVersionRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const { assertOwnStation } = require("../utils/stationScope");

// Creates one immutable checkpoint of a roster's current live state.
// Deliberately NOT called per single cell edit — call sites are: publish,
// before an auto-generated roster is applied over an existing one, before
// an Excel import commits, before a restore (of the state being replaced),
// and the manual "Create Version" button.
async function createVersion(rosterId, reason, actor, req, { isPublishedSnapshot = false } = {}) {
  const roster = await rosterVersionRepo.findRosterById(rosterId);
  if (!roster) throw ApiError.notFound("Roster not found");
  await assertOwnStation(actor, roster.stationId);

  const items = await rosterVersionRepo.liveSnapshotItems(rosterId);
  const versionNumber = await rosterVersionRepo.nextVersionNumber(rosterId);
  const version = await rosterVersionRepo.createVersion({
    rosterId, versionNumber, reason, isPublishedSnapshot,
    createdById: actor?.sub, createdByName: actor?.name || "System", items,
  });

  await auditTrail.recordCreate("RosterVersion", version.id, roster.stationId, actor, req);
  await auditTrail.logActivity(
    "Roster version created",
    `${roster.stationId} — ${roster.monthKey}: Version ${version.versionNumber}${reason ? ` (${reason})` : ""}`,
    roster.stationId, actor, req
  );

  return version;
}

async function listVersions(rosterId, actor) {
  const roster = await rosterVersionRepo.findRosterById(rosterId);
  if (!roster) throw ApiError.notFound("Roster not found");
  await assertOwnStation(actor, roster.stationId);

  const versions = await rosterVersionRepo.listVersionsForRoster(rosterId);
  return versions.map(v => ({
    id: v.id, rosterId: v.rosterId, versionNumber: v.versionNumber, reason: v.reason,
    isPublishedSnapshot: v.isPublishedSnapshot, restoredFromVersionId: v.restoredFromVersionId,
    createdById: v.createdById, createdByName: v.createdByName, createdAt: v.createdAt,
    itemCount: v._count.items,
  }));
}

async function getVersion(versionId, actor) {
  const version = await rosterVersionRepo.findVersionWithItemsAndRoster(versionId);
  if (!version) throw ApiError.notFound("Version not found");
  await assertOwnStation(actor, version.roster.stationId);
  return version;
}

function itemKey(item) {
  return `${item.userId}__${item.shiftDate.toISOString().slice(0, 10)}`;
}

function itemsEqual(a, b) {
  if (!a || !b) return false;
  return a.shiftCode === b.shiftCode
    && (a.in1 || null) === (b.in1 || null) && (a.out1 || null) === (b.out1 || null)
    && (a.in2 || null) === (b.in2 || null) && (a.out2 || null) === (b.out2 || null);
}

// Diffs two versions of the SAME roster cell-by-cell (keyed by staff +
// date) and returns only the cells that actually changed — what the
// "Compare" view renders, not a full re-listing of both grids.
async function compareVersions(fromVersionId, toVersionId, actor) {
  const [from, to] = await Promise.all([
    rosterVersionRepo.findVersionWithItemsAndRoster(fromVersionId),
    rosterVersionRepo.findVersionWithItemsAndRoster(toVersionId),
  ]);
  if (!from || !to) throw ApiError.notFound("Version not found");
  if (from.rosterId !== to.rosterId) throw ApiError.badRequest("Versions belong to different rosters");
  await assertOwnStation(actor, from.roster.stationId);

  const fromMap = new Map(from.items.map(i => [itemKey(i), i]));
  const toMap = new Map(to.items.map(i => [itemKey(i), i]));
  const allKeys = new Set([...fromMap.keys(), ...toMap.keys()]);

  const changedCells = [];
  for (const key of allKeys) {
    const a = fromMap.get(key);
    const b = toMap.get(key);
    if (itemsEqual(a, b)) continue;
    const [userId, shiftDate] = key.split("__");
    changedCells.push({
      userId, shiftDate,
      from: a ? { shiftCode: a.shiftCode, in1: a.in1, out1: a.out1, in2: a.in2, out2: a.out2 } : null,
      to: b ? { shiftCode: b.shiftCode, in1: b.in1, out1: b.out1, in2: b.in2, out2: b.out2 } : null,
    });
  }
  changedCells.sort((x, y) => x.shiftDate.localeCompare(y.shiftDate) || x.userId.localeCompare(y.userId));

  return {
    fromVersion: { id: from.id, versionNumber: from.versionNumber, reason: from.reason, createdAt: from.createdAt },
    toVersion: { id: to.id, versionNumber: to.versionNumber, reason: to.reason, createdAt: to.createdAt },
    changedCells,
  };
}

// Non-destructive restore: NEVER overwrites history in place. In one
// transaction, (1) snapshots whatever the live grid currently holds — even
// if it has drifted since the last checkpoint — as its own version, so
// that state is never simply lost, then (2) creates a brand-new "current"
// version carrying the restored content (pointing back at the version it
// was restored from), then (3) makes the live ShiftAssignment rows match
// it. RosterVersion/RosterVersionItem rows already written are never
// mutated by this or any other function — history stays append-only.
async function restoreVersion(versionId, actor, req) {
  const target = await rosterVersionRepo.findVersionWithItemsAndRoster(versionId);
  if (!target) throw ApiError.notFound("Version not found");
  const roster = target.roster;
  await assertOwnStation(actor, roster.stationId);

  const restored = await rosterVersionRepo.runTransaction(async (tx) => {
    let nextNum = await rosterVersionRepo.nextVersionNumber(roster.id, tx);

    const currentItems = await rosterVersionRepo.liveSnapshotItems(roster.id, tx);
    await rosterVersionRepo.createVersion({
      rosterId: roster.id, versionNumber: nextNum, reason: "Auto-snapshot before restore",
      createdById: actor?.sub, createdByName: actor?.name || "System", items: currentItems,
    }, tx);
    nextNum += 1;

    const restoredItems = target.items.map(i => ({
      userId: i.userId, shiftDate: i.shiftDate, shiftDefId: i.shiftDefId, shiftCode: i.shiftCode,
      note: i.note, in1: i.in1, out1: i.out1, in2: i.in2, out2: i.out2,
    }));
    const restoredVersion = await rosterVersionRepo.createVersion({
      rosterId: roster.id, versionNumber: nextNum, reason: `Restored from Version ${target.versionNumber}`,
      restoredFromVersionId: target.id,
      createdById: actor?.sub, createdByName: actor?.name || "System", items: restoredItems,
    }, tx);

    // Make the live grid match the restored snapshot exactly — including
    // removing cells the current grid has that the restored version didn't.
    await rosterVersionRepo.replaceLiveAssignments(roster.id, restoredItems, actor?.sub, tx);

    return restoredVersion;
  });

  await auditTrail.recordUpdate(
    "Roster", roster.id, roster.stationId,
    { liveState: `pre-restore (see Version ${restored.versionNumber - 1})` },
    { liveState: `Restored from Version ${target.versionNumber} (new Version ${restored.versionNumber})` },
    actor, req, `Restore Version ${target.versionNumber}`
  );
  await auditTrail.logActivity(
    "Roster version restored",
    `${roster.stationId} — ${roster.monthKey}: restored from Version ${target.versionNumber} → new Version ${restored.versionNumber}`,
    roster.stationId, actor, req
  );

  return restored;
}

module.exports = { createVersion, listVersions, getVersion, compareVersions, restoreVersion };
