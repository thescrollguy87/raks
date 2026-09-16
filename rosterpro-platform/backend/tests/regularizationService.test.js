jest.mock("../src/repositories/regularizationRepository");
jest.mock("../src/repositories/attendanceRepository");
jest.mock("../src/repositories/userRepository");
jest.mock("../src/utils/auditTrail");
jest.mock("../src/services/notificationService");

const regularizationRepo = require("../src/repositories/regularizationRepository");
const attendanceRepo = require("../src/repositories/attendanceRepository");
const userRepo = require("../src/repositories/userRepository");
const auditTrail = require("../src/utils/auditTrail");
const notificationService = require("../src/services/notificationService");
const regularizationService = require("../src/services/regularizationService");

const staff = { sub: "staff-1", roles: ["AME"], permissions: ["regularization:request"], stationId: "station-1" };
const l1Manager = { sub: "mgr-1", roles: ["SHIFT_INCHARGE"], permissions: ["regularization:approve_reports"], stationId: "station-1" };
const stationManager = { sub: "sm-1", roles: ["STATION_MANAGER"], permissions: ["regularization:approve"], stationId: "station-1" };

beforeEach(() => {
  jest.clearAllMocks();
  userRepo.findStationAndManager.mockResolvedValue({ stationId: "station-1", reportsToId: "mgr-1", fullName: "Staff One" });
  notificationService.notifyRegularizationRequested.mockResolvedValue({ sent: true });
  notificationService.notifyRegularizationDecision.mockResolvedValue({ sent: true });
});

describe("regularizationService.createRequest — roster-driven auto-exemption", () => {
  it("blocks filing a regularization request on a deputation-coded day", async () => {
    attendanceRepo.findScheduledShift.mockResolvedValue({
      shiftDefId: "sd-dep", shiftDef: { code: "DEP", type: "other" },
    });
    await expect(regularizationService.createRequest(
      { date: "2026-09-10", reason: "FORGOT_TO_PUNCH" }, staff, {}
    )).rejects.toMatchObject({ statusCode: 400 });
    expect(regularizationRepo.create).not.toHaveBeenCalled();
  });

  it("blocks filing when there's no scheduled duty at all for that date", async () => {
    attendanceRepo.findScheduledShift.mockResolvedValue(null);
    await expect(regularizationService.createRequest({ date: "2026-09-10", reason: "OTHER" }, staff, {}))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(regularizationRepo.create).not.toHaveBeenCalled();
  });

  it("blocks filing on a leave day the same way", async () => {
    attendanceRepo.findScheduledShift.mockResolvedValue({ shiftDefId: "sd-l", shiftDef: { code: "L", type: "leave" } });
    await expect(regularizationService.createRequest({ date: "2026-09-10", reason: "OTHER" }, staff, {}))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("allows filing on a genuine missed duty day and lazily creates the attendance record", async () => {
    attendanceRepo.findScheduledShift.mockResolvedValue({
      shiftDefId: "sd-m", shiftDef: { code: "M", type: "duty", startTime: "07:30", endTime: "15:30" },
    });
    attendanceRepo.findByUserAndDate.mockResolvedValue(null);
    attendanceRepo.create.mockResolvedValue({ id: "att-1" });
    regularizationRepo.findPendingForAttendanceRecord.mockResolvedValue(null);
    regularizationRepo.create.mockResolvedValue({ id: "reg-1", status: "PENDING" });
    userRepo.findById.mockResolvedValue({ id: "mgr-1", email: "mgr@example.com" });

    const result = await regularizationService.createRequest(
      { date: "2026-09-10", reason: "FORGOT_TO_PUNCH", detail: "Phone died" }, staff, {}
    );

    expect(result.id).toBe("reg-1");
    expect(attendanceRepo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "staff-1", status: "MISSING" }));
    expect(regularizationRepo.create).toHaveBeenCalledWith(expect.objectContaining({ attendanceRecordId: "att-1", userId: "staff-1", submittedById: "staff-1" }));
    expect(notificationService.notifyRegularizationRequested).toHaveBeenCalled();
  });

  it("rejects a duplicate request while one is already pending", async () => {
    attendanceRepo.findScheduledShift.mockResolvedValue({ shiftDefId: "sd-m", shiftDef: { code: "M", type: "duty" } });
    attendanceRepo.findByUserAndDate.mockResolvedValue({ id: "att-1" });
    regularizationRepo.findPendingForAttendanceRecord.mockResolvedValue({ id: "existing-reg" });

    await expect(regularizationService.createRequest({ date: "2026-09-10", reason: "OTHER" }, staff, {}))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("regularizationService.decide", () => {
  const pendingRequest = {
    id: "reg-1", status: "PENDING", attendanceRecordId: "att-1",
    user: { id: "staff-1", fullName: "Staff One", email: "s@example.com", stationId: "station-1", reportsToId: "mgr-1" },
    attendanceRecord: { id: "att-1", stationId: "station-1", date: new Date("2026-09-10") },
  };

  it("lets the L1 Manager (approve_reports) decide their own direct report's request", async () => {
    regularizationRepo.findById.mockResolvedValue(pendingRequest);
    regularizationRepo.decide.mockResolvedValue({ id: "reg-1", status: "APPROVED" });

    await regularizationService.decide("reg-1", { decision: "APPROVED" }, l1Manager, {});

    expect(regularizationRepo.decide).toHaveBeenCalledWith("reg-1", "APPROVED", l1Manager.sub, l1Manager.sub, undefined);
    expect(attendanceRepo.update).toHaveBeenCalledWith("att-1", { status: "REGULARIZED" });
  });

  it("blocks an L1 Manager from deciding someone who isn't their direct report", async () => {
    regularizationRepo.findById.mockResolvedValue({
      ...pendingRequest, user: { ...pendingRequest.user, reportsToId: "someone-else" },
    });
    await expect(regularizationService.decide("reg-1", { decision: "APPROVED" }, l1Manager, {}))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("lets a station-wide approver decide anyone at their station", async () => {
    regularizationRepo.findById.mockResolvedValue(pendingRequest);
    regularizationRepo.decide.mockResolvedValue({ id: "reg-1", status: "REJECTED" });
    await regularizationService.decide("reg-1", { decision: "REJECTED", reason: "Not enough info" }, stationManager, {});
    expect(regularizationRepo.decide).toHaveBeenCalledWith("reg-1", "REJECTED", stationManager.sub, stationManager.sub, "Not enough info");
    expect(attendanceRepo.update).not.toHaveBeenCalled(); // only APPROVED flips the attendance record's status
  });

  it("refuses to decide an already-decided request", async () => {
    regularizationRepo.findById.mockResolvedValue({ ...pendingRequest, status: "APPROVED" });
    await expect(regularizationService.decide("reg-1", { decision: "REJECTED", reason: "x" }, stationManager, {}))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});
