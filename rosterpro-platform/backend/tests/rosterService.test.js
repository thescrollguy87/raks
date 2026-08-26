jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/repositories/userRepository");
jest.mock("../src/utils/auditTrail");
jest.mock("../src/services/notificationService");

const rosterRepo = require("../src/repositories/rosterRepository");
const userRepo = require("../src/repositories/userRepository");
const auditTrail = require("../src/utils/auditTrail");
const notificationService = require("../src/services/notificationService");
const rosterService = require("../src/services/rosterService");
const ApiError = require("../src/utils/ApiError");

const actor = { sub: "user-1", name: "Rakesh Patel", roles: ["STATION_MANAGER"] };
const roster = { id: "roster-1", stationId: "station-1", monthKey: "2026-09", isPublished: false };

beforeEach(() => {
  // rosterService fires these fire-and-forget (`.catch(...)` without await),
  // so they must resolve to a real promise by default or the un-awaited
  // chain throws synchronously inside the service call.
  notificationService.notifyRosterPublished.mockResolvedValue([]);
  notificationService.notifyRosterUnpublished.mockResolvedValue([]);
  notificationService.notifyShiftChanged.mockResolvedValue({ sent: true });
  rosterRepo.findStationById.mockResolvedValue({ name: "Ahmedabad Line Maintenance" });
  rosterRepo.getActiveStaffContacts.mockResolvedValue([]);
  userRepo.findById.mockResolvedValue({ id: "staff-1", email: "staff@amd.example" });
});

describe("rosterService.getRosterGrid", () => {
  it("creates the roster on first access and returns the grid", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(null);
    rosterRepo.createRoster.mockResolvedValue(roster);
    rosterRepo.getRosterGrid.mockResolvedValue([{ id: "staff-1", fullName: "A", shiftAssignments: [] }]);

    const result = await rosterService.getRosterGrid("station-1", "2026-09", actor);

    expect(rosterRepo.createRoster).toHaveBeenCalledWith("station-1", "2026-09", actor.sub);
    expect(result.staff).toHaveLength(1);
  });

  it("reuses an existing roster without creating a duplicate", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(roster);
    rosterRepo.getRosterGrid.mockResolvedValue([]);

    await rosterService.getRosterGrid("station-1", "2026-09", actor);

    expect(rosterRepo.createRoster).not.toHaveBeenCalled();
  });
});

describe("rosterService.upsertShift", () => {
  const baseInput = { stationId: "station-1", monthKey: "2026-09", userId: "staff-1", shiftDate: "2026-09-05", shiftCode: "M" };

  beforeEach(() => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(roster);
    rosterRepo.findShiftDefByCode.mockResolvedValue({ id: "def-M", code: "M" });
  });

  it("rejects an unknown shift code", async () => {
    rosterRepo.findShiftDefByCode.mockResolvedValue(null);
    await expect(rosterService.upsertShift({ ...baseInput, shiftCode: "ZZZ" }, actor, {}))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses to edit a published roster", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ ...roster, isPublished: true });
    await expect(rosterService.upsertShift(baseInput, actor, {}))
      .rejects.toBeInstanceOf(ApiError);
  });

  it("writes an audit trail entry when the shift actually changes", async () => {
    rosterRepo.findAssignment.mockResolvedValue({ id: "sa-1", shiftDefId: "def-OLD" });
    rosterRepo.upsertAssignment.mockResolvedValue({ id: "sa-1", shiftDefId: "def-M" });

    const result = await rosterService.upsertShift(baseInput, actor, { ip: "1.2.3.4" });

    expect(result.changed).toBe(true);
    expect(auditTrail.recordUpdate).toHaveBeenCalledWith(
      "ShiftAssignment", "sa-1",
      { shiftDefId: "def-OLD" }, { shiftDefId: "def-M" },
      actor, expect.any(Object), undefined
    );
  });

  it("does NOT write an audit entry when the value is unchanged (idempotent save)", async () => {
    rosterRepo.findAssignment.mockResolvedValue({ id: "sa-1", shiftDefId: "def-M" });
    rosterRepo.upsertAssignment.mockResolvedValue({ id: "sa-1", shiftDefId: "def-M" });

    const result = await rosterService.upsertShift(baseInput, actor, {});

    expect(result.changed).toBe(false);
    expect(auditTrail.recordUpdate).not.toHaveBeenCalled();
  });

  it("fires the shift-change notification with the correct old/new codes when the value changes", async () => {
    rosterRepo.findAssignment.mockResolvedValue({ id: "sa-1", shiftDefId: "def-OLD" });
    rosterRepo.upsertAssignment.mockResolvedValue({ id: "sa-1", shiftDefId: "def-M" });
    rosterRepo.findShiftDefById.mockResolvedValue({ id: "def-OLD", code: "A" });
    userRepo.findById.mockResolvedValue({ id: "staff-1", email: "staff@amd.example", phone: "+911234567890" });

    await rosterService.upsertShift(baseInput, actor, {});
    await new Promise(r => setTimeout(r, 0)); // let the fire-and-forget notification microtask run

    expect(notificationService.notifyShiftChanged).toHaveBeenCalledWith(
      { id: "staff-1", email: "staff@amd.example", phone: "+911234567890" },
      { shiftDate: "2026-09-05", oldCode: "A", newCode: "M" }
    );
  });

  it("does NOT fire a shift-change notification when the value is unchanged", async () => {
    rosterRepo.findAssignment.mockResolvedValue({ id: "sa-1", shiftDefId: "def-M" });
    rosterRepo.upsertAssignment.mockResolvedValue({ id: "sa-1", shiftDefId: "def-M" });

    await rosterService.upsertShift(baseInput, actor, {});
    await new Promise(r => setTimeout(r, 0));

    expect(notificationService.notifyShiftChanged).not.toHaveBeenCalled();
  });
});

describe("rosterService.publishRoster", () => {
  it("rejects publishing an already-published roster", async () => {
    rosterRepo.findRosterById.mockResolvedValue({ ...roster, isPublished: true });
    await expect(rosterService.publishRoster("roster-1", actor, {}))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("publishes and records both audit trail and activity log", async () => {
    rosterRepo.findRosterById.mockResolvedValue(roster);
    rosterRepo.publishRoster.mockResolvedValue({ ...roster, isPublished: true });

    await rosterService.publishRoster("roster-1", actor, {});

    expect(auditTrail.recordUpdate).toHaveBeenCalled();
    expect(auditTrail.logActivity).toHaveBeenCalledWith("Roster published", expect.any(String), actor, {});
  });

  it("fans the publish notification out to every active station staff member", async () => {
    rosterRepo.findRosterById.mockResolvedValue(roster);
    rosterRepo.publishRoster.mockResolvedValue({ ...roster, isPublished: true });
    rosterRepo.getActiveStaffContacts.mockResolvedValue([{ id: "s1" }, { id: "s2" }, { id: "s3" }]);

    await rosterService.publishRoster("roster-1", actor, {});
    await new Promise(r => setTimeout(r, 0));

    expect(notificationService.notifyRosterPublished).toHaveBeenCalledWith(
      [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
      { stationName: "Ahmedabad Line Maintenance", monthKey: "2026-09" }
    );
  });
});

describe("rosterService.unpublishRoster", () => {
  it("requires a non-empty reason", async () => {
    rosterRepo.findRosterById.mockResolvedValue({ ...roster, isPublished: true });
    await expect(rosterService.unpublishRoster("roster-1", "", actor, {}))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(rosterService.unpublishRoster("roster-1", "   ", actor, {}))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects unpublishing a roster that isn't published", async () => {
    rosterRepo.findRosterById.mockResolvedValue({ ...roster, isPublished: false });
    await expect(rosterService.unpublishRoster("roster-1", "correcting an error", actor, {}))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("unpublishes with a valid reason and records the audit trail", async () => {
    rosterRepo.findRosterById.mockResolvedValue({ ...roster, isPublished: true });
    rosterRepo.unpublishRoster.mockResolvedValue({ ...roster, isPublished: false });

    const result = await rosterService.unpublishRoster("roster-1", "Staff went on emergency leave", actor, {});

    expect(result.isPublished).toBe(false);
    expect(auditTrail.recordUpdate).toHaveBeenCalledWith(
      "Roster", "roster-1", { isPublished: true }, { isPublished: false }, actor, {}, "Staff went on emergency leave"
    );
  });
});
