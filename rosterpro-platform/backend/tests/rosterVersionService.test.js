jest.mock("../src/repositories/rosterVersionRepository");
jest.mock("../src/utils/auditTrail");

const rosterVersionRepo = require("../src/repositories/rosterVersionRepository");
const auditTrail = require("../src/utils/auditTrail");
const rosterVersionService = require("../src/services/rosterVersionService");
const ApiError = require("../src/utils/ApiError");

const actor = { sub: "user-1", name: "Rakesh Patel", roles: ["STATION_MANAGER"], stationId: "station-1" };
const roster = { id: "roster-1", stationId: "station-1", monthKey: "2026-09" };

beforeEach(() => {
  rosterVersionRepo.findRosterById.mockResolvedValue(roster);
  rosterVersionRepo.liveSnapshotItems.mockResolvedValue([]);
  rosterVersionRepo.nextVersionNumber.mockResolvedValue(1);
  rosterVersionRepo.createVersion.mockResolvedValue({ id: "version-x", versionNumber: 1 });
  rosterVersionRepo.runTransaction.mockImplementation((fn) => fn({}));
});

describe("rosterVersionService.createVersion", () => {
  it("rejects a caller from a different station", async () => {
    rosterVersionRepo.findRosterById.mockResolvedValue({ ...roster, stationId: "station-OTHER" });
    await expect(rosterVersionService.createVersion("roster-1", "Manual checkpoint", actor, {}))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("snapshots current live assignments and records the audit trail", async () => {
    rosterVersionRepo.liveSnapshotItems.mockResolvedValue([{ userId: "u1", shiftDate: new Date("2026-09-05"), shiftDefId: "def-M", shiftCode: "M" }]);
    rosterVersionRepo.nextVersionNumber.mockResolvedValue(3);
    rosterVersionRepo.createVersion.mockResolvedValue({ id: "version-3", versionNumber: 3 });

    const result = await rosterVersionService.createVersion("roster-1", "Published", actor, {}, { isPublishedSnapshot: true });

    expect(rosterVersionRepo.createVersion).toHaveBeenCalledWith(expect.objectContaining({
      rosterId: "roster-1", versionNumber: 3, reason: "Published", isPublishedSnapshot: true,
      items: [expect.objectContaining({ userId: "u1", shiftCode: "M" })],
    }));
    expect(auditTrail.recordCreate).toHaveBeenCalledWith("RosterVersion", "version-3", "station-1", actor, {});
    expect(auditTrail.logActivity).toHaveBeenCalled();
    expect(result.versionNumber).toBe(3);
  });
});

describe("rosterVersionService.listVersions / getVersion", () => {
  it("rejects listing versions for another station's roster", async () => {
    rosterVersionRepo.findRosterById.mockResolvedValue({ ...roster, stationId: "station-OTHER" });
    await expect(rosterVersionService.listVersions("roster-1", actor)).rejects.toBeInstanceOf(ApiError);
  });

  it("maps item counts through", async () => {
    rosterVersionRepo.listVersionsForRoster.mockResolvedValue([
      { id: "v2", rosterId: "roster-1", versionNumber: 2, reason: "Published", isPublishedSnapshot: true, restoredFromVersionId: null, createdById: "user-1", createdByName: "Rakesh Patel", createdAt: new Date(), _count: { items: 40 } },
    ]);
    const result = await rosterVersionService.listVersions("roster-1", actor);
    expect(result).toEqual([expect.objectContaining({ id: "v2", versionNumber: 2, itemCount: 40 })]);
  });

  it("404s when the version doesn't exist", async () => {
    rosterVersionRepo.findVersionWithItemsAndRoster.mockResolvedValue(null);
    await expect(rosterVersionService.getVersion("missing", actor)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("rosterVersionService.compareVersions", () => {
  it("returns only the cells that actually changed between two versions", async () => {
    const day = new Date("2026-09-05T00:00:00.000Z");
    rosterVersionRepo.findVersionWithItemsAndRoster
      .mockResolvedValueOnce({
        id: "v1", rosterId: "roster-1", versionNumber: 1, reason: null, createdAt: new Date(),
        roster: { stationId: "station-1" },
        items: [
          { userId: "u1", shiftDate: day, shiftDefId: "def-A", shiftCode: "A", in1: null, out1: null, in2: null, out2: null },
          { userId: "u2", shiftDate: day, shiftDefId: "def-M", shiftCode: "M", in1: null, out1: null, in2: null, out2: null },
        ],
      })
      .mockResolvedValueOnce({
        id: "v2", rosterId: "roster-1", versionNumber: 2, reason: null, createdAt: new Date(),
        roster: { stationId: "station-1" },
        items: [
          { userId: "u1", shiftDate: day, shiftDefId: "def-N", shiftCode: "N", in1: null, out1: null, in2: null, out2: null },
          { userId: "u2", shiftDate: day, shiftDefId: "def-M", shiftCode: "M", in1: null, out1: null, in2: null, out2: null },
        ],
      });

    const result = await rosterVersionService.compareVersions("v1", "v2", actor);

    expect(result.changedCells).toHaveLength(1);
    expect(result.changedCells[0]).toMatchObject({
      userId: "u1", from: { shiftCode: "A" }, to: { shiftCode: "N" },
    });
  });

  it("rejects comparing versions from two different rosters", async () => {
    rosterVersionRepo.findVersionWithItemsAndRoster
      .mockResolvedValueOnce({ id: "v1", rosterId: "roster-1", items: [], roster: { stationId: "station-1" } })
      .mockResolvedValueOnce({ id: "v2", rosterId: "roster-2", items: [], roster: { stationId: "station-1" } });
    await expect(rosterVersionService.compareVersions("v1", "v2", actor)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("rosterVersionService.restoreVersion", () => {
  const oldDay = new Date("2026-09-01T00:00:00.000Z");
  const target = {
    id: "version-10", rosterId: "roster-1", versionNumber: 10, roster,
    items: [{ userId: "u1", shiftDate: oldDay, shiftDefId: "def-A", shiftCode: "A", in1: null, out1: null, in2: null, out2: null }],
  };

  beforeEach(() => {
    rosterVersionRepo.findVersionWithItemsAndRoster.mockResolvedValue(target);
    rosterVersionRepo.nextVersionNumber.mockResolvedValue(15);
    rosterVersionRepo.liveSnapshotItems.mockResolvedValue([
      { userId: "u1", shiftDate: oldDay, shiftDefId: "def-N", shiftCode: "N", in1: null, out1: null, in2: null, out2: null },
    ]);
    rosterVersionRepo.createVersion
      .mockResolvedValueOnce({ id: "auto-snapshot", versionNumber: 15 })
      .mockResolvedValueOnce({ id: "restored", versionNumber: 16 });
    rosterVersionRepo.replaceLiveAssignments.mockResolvedValue(undefined);
  });

  it("never overwrites history: it auto-snapshots current state, then creates a NEW version above the current max, never mutating the restored-from version", async () => {
    const result = await rosterVersionService.restoreVersion("version-10", actor, {});

    // Two version rows written — the drift-preserving auto-snapshot (15)
    // first, then the actual restored version (16) — never one update to
    // an existing row, and never touching version 10 itself.
    expect(rosterVersionRepo.createVersion).toHaveBeenCalledTimes(2);
    expect(rosterVersionRepo.createVersion.mock.calls[0][0]).toMatchObject({
      rosterId: "roster-1", versionNumber: 15, reason: "Auto-snapshot before restore",
    });
    expect(rosterVersionRepo.createVersion.mock.calls[1][0]).toMatchObject({
      rosterId: "roster-1", versionNumber: 16, reason: "Restored from Version 10", restoredFromVersionId: "version-10",
      items: [expect.objectContaining({ userId: "u1", shiftCode: "A" })],
    });
    expect(result.versionNumber).toBe(16);
  });

  it("overwrites the live grid to match the restored version's content", async () => {
    await rosterVersionService.restoreVersion("version-10", actor, {});
    expect(rosterVersionRepo.replaceLiveAssignments).toHaveBeenCalledWith(
      "roster-1", [expect.objectContaining({ userId: "u1", shiftCode: "A" })], "user-1", {}
    );
  });

  it("logs an audit entry naming both the restored-from and the new version", async () => {
    await rosterVersionService.restoreVersion("version-10", actor, {});
    expect(auditTrail.logActivity).toHaveBeenCalledWith(
      "Roster version restored",
      expect.stringContaining("restored from Version 10"),
      "station-1", actor, {}
    );
  });

  it("rejects restoring into another station's roster", async () => {
    rosterVersionRepo.findVersionWithItemsAndRoster.mockResolvedValue({
      ...target, roster: { ...roster, stationId: "station-OTHER" },
    });
    await expect(rosterVersionService.restoreVersion("version-10", actor, {})).rejects.toMatchObject({ statusCode: 404 });
  });
});
