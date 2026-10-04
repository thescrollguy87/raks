jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/repositories/leaveRepository");
jest.mock("../src/services/complianceService");
jest.mock("../src/utils/auditTrail");

const { buildLeaveByUserDay, leaveCodeForType } = require("../src/services/rosterGenerationService");

describe("rosterGenerationService.buildLeaveByUserDay", () => {
  it("converts a leave range fully within the month into the correct day set", () => {
    const leaves = [{ userId: "u1", leaveType: "ANNUAL", fromDate: new Date("2026-09-05T00:00:00.000Z"), toDate: new Date("2026-09-07T00:00:00.000Z") }];
    const map = buildLeaveByUserDay(leaves, "2026-09", 30);
    expect([...map.u1.keys()].sort((a, b) => a - b)).toEqual([5, 6, 7]);
    expect(map.u1.get(5)).toBe("ANNUAL");
  });

  it("clips a leave range that started in the prior month to day 1 onward", () => {
    const leaves = [{ userId: "u2", leaveType: "ANNUAL", fromDate: new Date("2026-08-29T00:00:00.000Z"), toDate: new Date("2026-09-02T00:00:00.000Z") }];
    const map = buildLeaveByUserDay(leaves, "2026-09", 30);
    expect([...map.u2.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("clips a leave range that extends into the next month to the last day", () => {
    const leaves = [{ userId: "u3", leaveType: "ANNUAL", fromDate: new Date("2026-09-29T00:00:00.000Z"), toDate: new Date("2026-10-03T00:00:00.000Z") }];
    const map = buildLeaveByUserDay(leaves, "2026-09", 30);
    expect([...map.u3.keys()].sort((a, b) => a - b)).toEqual([29, 30]);
  });
});

describe("rosterGenerationService.leaveCodeForType", () => {
  it("resolves Training and Deputation to their own codes, and every other leave type to the plain Leave code", () => {
    expect(leaveCodeForType("TRAINING")).toBe("TRG");
    expect(leaveCodeForType("DEPUTATION")).toBe("D");
    expect(leaveCodeForType("ANNUAL")).toBe("L");
    expect(leaveCodeForType("SICK")).toBe("L");
    expect(leaveCodeForType("OTHER")).toBe("L");
  });
});
