jest.mock("../src/repositories/complianceRepository");
jest.mock("../src/utils/auditTrail");

const repo = require("../src/repositories/complianceRepository");
const svc = require("../src/services/complianceService");

const DAY = 24 * 60 * 60 * 1000;

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
