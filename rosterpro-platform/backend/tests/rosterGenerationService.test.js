jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/repositories/leaveRepository");
jest.mock("../src/services/complianceService");
jest.mock("../src/utils/auditTrail");

const { buildLeaveByUserDay } = require("../src/services/rosterGenerationService");

describe("rosterGenerationService.buildLeaveByUserDay", () => {
  it("converts a leave range fully within the month into the correct day set", () => {
    const leaves = [{ userId: "u1", fromDate: new Date("2026-09-05T00:00:00.000Z"), toDate: new Date("2026-09-07T00:00:00.000Z") }];
    const map = buildLeaveByUserDay(leaves, "2026-09", 30);
    expect([...map.u1].sort((a, b) => a - b)).toEqual([5, 6, 7]);
  });

  it("clips a leave range that started in the prior month to day 1 onward", () => {
    const leaves = [{ userId: "u2", fromDate: new Date("2026-08-29T00:00:00.000Z"), toDate: new Date("2026-09-02T00:00:00.000Z") }];
    const map = buildLeaveByUserDay(leaves, "2026-09", 30);
    expect([...map.u2].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("clips a leave range that extends into the next month to the last day", () => {
    const leaves = [{ userId: "u3", fromDate: new Date("2026-09-29T00:00:00.000Z"), toDate: new Date("2026-10-03T00:00:00.000Z") }];
    const map = buildLeaveByUserDay(leaves, "2026-09", 30);
    expect([...map.u3].sort((a, b) => a - b)).toEqual([29, 30]);
  });
});
