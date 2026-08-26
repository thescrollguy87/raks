jest.mock("../src/repositories/leaveRepository");
jest.mock("../src/repositories/userRepository");
jest.mock("../src/utils/auditTrail");
jest.mock("../src/services/notificationService");

const leaveRepo = require("../src/repositories/leaveRepository");
const userRepo = require("../src/repositories/userRepository");
const auditTrail = require("../src/utils/auditTrail");
const notificationService = require("../src/services/notificationService");
const leaveService = require("../src/services/leaveService");
const ApiError = require("../src/utils/ApiError");

const actor = { sub: "user-1", name: "Rakesh Patel", roles: ["AME"] };
const managerActor = { sub: "mgr-1", name: "Station Manager", roles: ["STATION_MANAGER"] };

beforeEach(() => {
  leaveRepo.DEFAULT_ENTITLEMENT = { ANNUAL: 30, SICK: 12, CASUAL: 12, MEDICAL: 0, LWP: 0, TRAINING: 0, OTHER: 0 };
  notificationService.notifyLeaveDecision.mockResolvedValue({ sent: true });
});

describe("leaveService.requestLeave", () => {
  it("creates a leave request and logs it", async () => {
    leaveRepo.findOverlapping.mockResolvedValue(null);
    leaveRepo.create.mockResolvedValue({ id: "leave-1" });

    const result = await leaveService.requestLeave(
      { leaveType: "ANNUAL", fromDate: "2026-09-05", toDate: "2026-09-07" }, actor, {}
    );

    expect(result.id).toBe("leave-1");
    expect(auditTrail.recordCreate).toHaveBeenCalledWith("Leave", "leave-1", actor, {});
  });

  it("rejects an overlapping leave request", async () => {
    leaveRepo.findOverlapping.mockResolvedValue({ id: "existing-leave" });
    await expect(leaveService.requestLeave(
      { leaveType: "ANNUAL", fromDate: "2026-09-05", toDate: "2026-09-07" }, actor, {}
    )).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("leaveService.decideLeave", () => {
  it("rejects deciding on a leave that isn't pending", async () => {
    leaveRepo.findById.mockResolvedValue({ id: "leave-1", status: "APPROVED", user: { fullName: "X" } });
    await expect(leaveService.decideLeave("leave-1", { decision: "APPROVED" }, managerActor, {}))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("approves a pending leave and records the audit trail", async () => {
    leaveRepo.findById.mockResolvedValue({
      id: "leave-1", status: "PENDING", userId: "staff-1", leaveType: "ANNUAL",
      fromDate: new Date("2026-09-05"), toDate: new Date("2026-09-07"),
      user: { fullName: "Staff One", email: "staff@amd.example" },
    });
    leaveRepo.decide.mockResolvedValue({ id: "leave-1", status: "APPROVED" });

    await leaveService.decideLeave("leave-1", { decision: "APPROVED" }, managerActor, {});

    expect(leaveRepo.decide).toHaveBeenCalledWith("leave-1", "APPROVED", managerActor.sub, managerActor.sub);
    expect(auditTrail.recordUpdate).toHaveBeenCalledWith(
      "Leave", "leave-1", { status: "PENDING" }, { status: "APPROVED" }, managerActor, {}, undefined
    );
  });

  it("notifies the leave owner of the decision", async () => {
    const owner = { id: "staff-1", fullName: "Staff One", email: "staff@amd.example" };
    leaveRepo.findById.mockResolvedValue({
      id: "leave-1", status: "PENDING", userId: "staff-1", leaveType: "SICK",
      fromDate: new Date("2026-09-05"), toDate: new Date("2026-09-07"), user: owner,
    });
    leaveRepo.decide.mockResolvedValue({ id: "leave-1", status: "REJECTED" });

    await leaveService.decideLeave("leave-1", { decision: "REJECTED", reason: "Coverage gap" }, managerActor, {});

    expect(notificationService.notifyLeaveDecision).toHaveBeenCalledWith(owner, {
      leaveType: "SICK", fromDate: "2026-09-05", toDate: "2026-09-07",
      decision: "REJECTED", reason: "Coverage gap",
    });
  });
});

describe("leaveService.cancelLeave", () => {
  it("lets the leave owner cancel their own pending request", async () => {
    leaveRepo.findById.mockResolvedValue({ id: "leave-1", userId: actor.sub, status: "PENDING" });
    leaveRepo.cancel.mockResolvedValue({ id: "leave-1", status: "CANCELLED" });
    const result = await leaveService.cancelLeave("leave-1", actor, {});
    expect(result.status).toBe("CANCELLED");
  });

  it("blocks a non-manager from cancelling someone else's leave", async () => {
    leaveRepo.findById.mockResolvedValue({ id: "leave-1", userId: "someone-else", status: "PENDING" });
    await expect(leaveService.cancelLeave("leave-1", actor, {}))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("allows a station manager to cancel someone else's leave", async () => {
    leaveRepo.findById.mockResolvedValue({ id: "leave-1", userId: "someone-else", status: "PENDING" });
    leaveRepo.cancel.mockResolvedValue({ id: "leave-1", status: "CANCELLED" });
    const result = await leaveService.cancelLeave("leave-1", managerActor, {});
    expect(result.status).toBe("CANCELLED");
  });

  it("refuses to cancel an already-cancelled leave", async () => {
    leaveRepo.findById.mockResolvedValue({ id: "leave-1", userId: actor.sub, status: "CANCELLED" });
    await expect(leaveService.cancelLeave("leave-1", actor, {}))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("leaveService.getBalance", () => {
  it("computes remaining balance from approved leave days taken, clipped to the year", async () => {
    userRepo.findById.mockResolvedValue({ id: "staff-1" });
    leaveRepo.approvedLeavesForYear.mockResolvedValue([
      { leaveType: "ANNUAL", fromDate: new Date("2026-03-01"), toDate: new Date("2026-03-05") }, // 5 days
      { leaveType: "SICK", fromDate: new Date("2026-06-10"), toDate: new Date("2026-06-10") },   // 1 day
    ]);

    const result = await leaveService.getBalance("staff-1", 2026);

    expect(result.balance.ANNUAL).toEqual({ entitlement: 30, taken: 5, remaining: 25 });
    expect(result.balance.SICK).toEqual({ entitlement: 12, taken: 1, remaining: 11 });
    expect(result.balance.CASUAL).toEqual({ entitlement: 12, taken: 0, remaining: 12 });
  });

  it("throws if the user doesn't exist", async () => {
    userRepo.findById.mockResolvedValue(null);
    await expect(leaveService.getBalance("nobody", 2026)).rejects.toMatchObject({ statusCode: 404 });
  });
});
