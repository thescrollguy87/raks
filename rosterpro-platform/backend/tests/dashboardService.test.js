jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/repositories/complianceRepository");
jest.mock("../src/repositories/flightRepository");
jest.mock("../src/services/complianceService");
jest.mock("../src/services/leaveService");

const rosterRepo = require("../src/repositories/rosterRepository");
const flightRepo = require("../src/repositories/flightRepository");
const complianceService = require("../src/services/complianceService");
const dashboardService = require("../src/services/dashboardService");

describe("dashboardService.rosterCoverageWidget", () => {
  it("throws 404 when no roster exists for the month", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(null);
    await expect(dashboardService.rosterCoverageWidget("station-1", "2026-10"))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("flags a shift with zero B1 coverage, and a night shift with zero B2 coverage", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1", isPublished: true });
    rosterRepo.getRosterGrid.mockResolvedValue([
      { id: "s1", fullName: "B1 Engineer", category: "B1", shiftAssignments: [
        { shiftDate: new Date("2026-09-01"), shiftDef: { code: "M", type: "duty" } },
        { shiftDate: new Date("2026-09-02"), shiftDef: { code: "N", type: "night" } }, // B1 present, no B2
      ]},
      { id: "s2", fullName: "CM Tech", category: "CM", shiftAssignments: [
        { shiftDate: new Date("2026-09-01"), shiftDef: { code: "A", type: "duty" } }, // Afternoon has no B1 at all
      ]},
    ]);

    const coverage = await dashboardService.rosterCoverageWidget("station-1", "2026-09");

    expect(coverage.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: "2026-09-01", shift: "A", issue: expect.stringContaining("No B1") }),
      expect.objectContaining({ date: "2026-09-02", shift: "N", issue: expect.stringContaining("No B2") }),
    ]));
    // Morning shift on day 1 had a B1 present — must NOT be flagged.
    expect(coverage.violations.some(v => v.date === "2026-09-01" && v.shift === "M")).toBe(false);
  });
});

describe("dashboardService.staffWorkloadWidget", () => {
  it("flags staff notably above the group's average duty days", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    const makeAssignments = (n) => Array(n).fill(0).map((_, i) => ({ shiftDate: new Date(2026, 8, i + 1), shiftDef: { type: "duty" } }));
    rosterRepo.getRosterGrid.mockResolvedValue([
      { id: "s1", fullName: "Overloaded Staff", category: "B1", shiftAssignments: makeAssignments(20) },
      { id: "s2", fullName: "Normal Staff A", category: "B1", shiftAssignments: makeAssignments(10) },
      { id: "s3", fullName: "Normal Staff B", category: "B1", shiftAssignments: makeAssignments(10) },
    ]);

    const workload = await dashboardService.staffWorkloadWidget("station-1", "2026-09");

    expect(workload.overloaded).toHaveLength(1);
    expect(workload.overloaded[0].fullName).toBe("Overloaded Staff");
  });
});

describe("dashboardService.dgcaComplianceWidget", () => {
  it("computes the compliance rate from blocked vs total active staff", async () => {
    rosterRepo.getActiveStaffContacts.mockResolvedValue([
      { id: "s1", fullName: "A" }, { id: "s2", fullName: "B" }, { id: "s3", fullName: "C" }, { id: "s4", fullName: "D" },
    ]);
    complianceService.getComplianceSummary.mockImplementation(async (id) => ({ isBlocked: id === "s2" }));

    const result = await dashboardService.dgcaComplianceWidget("station-1");

    expect(result.blockedStaffCount).toBe(1);
    expect(result.complianceRate).toBe(75);
  });
});

describe("dashboardService.flightCoverageWidget", () => {
  it("counts unique delayed flights (not delay records) and computes on-time rate", async () => {
    flightRepo.listFlightsForStation.mockResolvedValue([{ id: "f1" }, { id: "f2" }, { id: "f3" }, { id: "f4" }]);
    flightRepo.listDelaysForStation.mockResolvedValue([
      { flightId: "f1", minutes: 30 }, { flightId: "f1", minutes: 15 }, // two delay records, same flight
    ]);

    const result = await dashboardService.flightCoverageWidget("station-1", "2026-09-01", "2026-09-30");

    expect(result.delayedFlights).toBe(1);
    expect(result.onTimeRate).toBe(75);
    expect(result.totalEngineeringDelayMinutes).toBe(45);
  });
});
