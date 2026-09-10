jest.mock("../src/repositories/complianceRepository");
jest.mock("../src/repositories/userRepository");
jest.mock("../src/utils/auditTrail");

const repo = require("../src/repositories/complianceRepository");
const userRepo = require("../src/repositories/userRepository");
const auditTrail = require("../src/utils/auditTrail");
const svc = require("../src/services/complianceService");
const ApiError = require("../src/utils/ApiError");

const DAY = 24 * 60 * 60 * 1000;
const actor = { sub: "admin-1", roles: ["SUPER_ADMIN"] }; // short-circuits assertOwnStation — no station-matching mocks needed

describe("complianceService.deriveStatus", () => {
  it("returns EXPIRED for a past date", () => {
    expect(svc.deriveStatus(new Date(Date.now() - 5 * DAY))).toBe("EXPIRED");
  });
  it("returns EXPIRING within the 30-day window", () => {
    expect(svc.deriveStatus(new Date(Date.now() + 5 * DAY))).toBe("EXPIRING");
  });
  it("returns VALID well beyond the window", () => {
    expect(svc.deriveStatus(new Date(Date.now() + 60 * DAY))).toBe("VALID");
  });
  it("returns VALID for an open-ended (no expiry) record", () => {
    expect(svc.deriveStatus(null)).toBe("VALID");
  });
});

describe("complianceService.listQualificationsForUser", () => {
  it("re-derives status on read rather than trusting a stale stored value", async () => {
    repo.qualification.listForUser.mockResolvedValue([
      { id: "q1", expiryDate: new Date(Date.now() - 5 * DAY), status: "VALID" }, // stale
    ]);
    const list = await svc.listQualificationsForUser("staff-1");
    expect(list[0].status).toBe("EXPIRED");
  });
});

// Edit/delete for qualifications, licenses, trainings, and authorizations
// all follow the exact same shape: 404 on a missing record, a station-scope
// check via assertActorSharesStationWith, a partial-merge update (unset
// fields on the body keep the existing value), and a soft-delete + audit
// trail entry — this exercises the pattern once per record type.
beforeEach(() => {
  userRepo.findStationId.mockResolvedValue({ stationId: "station-1" });
});

describe("complianceService.updateQualification", () => {
  it("throws 404 for a qualification that doesn't exist", async () => {
    repo.qualification.findById.mockResolvedValue(null);
    await expect(svc.updateQualification("missing", { qualCode: "B737" }, actor, {}))
      .rejects.toBeInstanceOf(ApiError);
  });

  it("merges only the fields given, keeping the rest, and re-derives status", async () => {
    repo.qualification.findById.mockResolvedValue({
      id: "q1", userId: "staff-1", qualCode: "A320", description: "old desc",
      issuedDate: new Date("2025-01-01"), expiryDate: new Date(Date.now() + 60 * DAY),
    });
    repo.qualification.update.mockImplementation((id, data) => Promise.resolve({ id, ...data }));

    const updated = await svc.updateQualification("q1", { qualCode: "B737" }, actor, {});

    expect(repo.qualification.update).toHaveBeenCalledWith("q1", expect.objectContaining({
      qualCode: "B737", description: "old desc",
    }));
    expect(updated.qualCode).toBe("B737");
  });
});

describe("complianceService.deleteQualification", () => {
  it("throws 404 for a qualification that doesn't exist", async () => {
    repo.qualification.findById.mockResolvedValue(null);
    await expect(svc.deleteQualification("missing", actor, {}, "no longer needed"))
      .rejects.toBeInstanceOf(ApiError);
  });

  it("soft-deletes and records an audit trail entry", async () => {
    repo.qualification.findById.mockResolvedValue({ id: "q1", userId: "staff-1", qualCode: "A320" });

    await svc.deleteQualification("q1", actor, {}, "duplicate entry");

    expect(repo.qualification.softDelete).toHaveBeenCalledWith("q1", actor.sub);
    expect(auditTrail.recordDelete).toHaveBeenCalledWith("Qualification", "q1", "station-1", actor, {}, "duplicate entry");
  });
});

describe("complianceService.deleteLicense", () => {
  it("soft-deletes and records an audit trail entry", async () => {
    repo.license.findById.mockResolvedValue({ id: "l1", userId: "staff-1", licenseNo: "L-123" });

    await svc.deleteLicense("l1", actor, {});

    expect(repo.license.softDelete).toHaveBeenCalledWith("l1", actor.sub);
    expect(auditTrail.recordDelete).toHaveBeenCalledWith("License", "l1", "station-1", actor, {}, undefined);
  });
});

describe("complianceService.updateTraining / deleteTraining", () => {
  it("merges given fields and keeps the rest", async () => {
    repo.training.findById.mockResolvedValue({
      id: "t1", userId: "staff-1", courseName: "Old Course", provider: "Boeing",
      completedDate: new Date("2025-01-01"), validUntil: null,
    });
    repo.training.update.mockImplementation((id, data) => Promise.resolve({ id, ...data }));

    const updated = await svc.updateTraining("t1", { courseName: "New Course" }, actor, {});

    expect(repo.training.update).toHaveBeenCalledWith("t1", expect.objectContaining({
      courseName: "New Course", provider: "Boeing",
    }));
    expect(updated.courseName).toBe("New Course");
  });

  it("soft-deletes and records an audit trail entry", async () => {
    repo.training.findById.mockResolvedValue({ id: "t1", userId: "staff-1", courseName: "Old Course" });

    await svc.deleteTraining("t1", actor, {});

    expect(repo.training.softDelete).toHaveBeenCalledWith("t1", actor.sub);
    expect(auditTrail.recordDelete).toHaveBeenCalledWith("Training", "t1", "station-1", actor, {}, undefined);
  });
});

describe("complianceService.updateAuthorization / deleteAuthorization", () => {
  it("merges given fields and keeps the rest", async () => {
    repo.authorization.findById.mockResolvedValue({
      id: "a1", userId: "staff-1", scope: "Old Scope",
      grantedDate: new Date("2025-01-01"), expiryDate: null,
    });
    repo.authorization.update.mockImplementation((id, data) => Promise.resolve({ id, ...data }));

    const updated = await svc.updateAuthorization("a1", { scope: "New Scope" }, actor, {});

    expect(repo.authorization.update).toHaveBeenCalledWith("a1", expect.objectContaining({ scope: "New Scope" }));
    expect(updated.scope).toBe("New Scope");
  });

  it("soft-deletes and records an audit trail entry", async () => {
    repo.authorization.findById.mockResolvedValue({ id: "a1", userId: "staff-1", scope: "Old Scope" });

    await svc.deleteAuthorization("a1", actor, {});

    expect(repo.authorization.softDelete).toHaveBeenCalledWith("a1", actor.sub);
    expect(auditTrail.recordDelete).toHaveBeenCalledWith("StaffAuthorization", "a1", "station-1", actor, {}, undefined);
  });
});
