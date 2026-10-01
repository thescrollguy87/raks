jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/repositories/leaveRepository");
jest.mock("../src/services/complianceService");
jest.mock("../src/services/rosterGenerationService");
jest.mock("../src/utils/stationScope");

const rosterRepo = require("../src/repositories/rosterRepository");
const leaveRepo = require("../src/repositories/leaveRepository");
const complianceService = require("../src/services/complianceService");
const rosterGenerationService = require("../src/services/rosterGenerationService");
const { resolveAirlineId } = require("../src/utils/stationScope");
const { getManpowerPlan } = require("../src/services/rosterPlanningService");

const EMPTY_SHIFT = { B1: 0, B2: 0, CM: 0, NCS: 0 };
const emptyWorkloadContextFields = {
  flightSummary: { operatingDays: 0, totalMovements: 0 },
  plannedDemand: { totalHours: 0, byCategory: { B1: 0, B2: 0, CM: 0, NCS: 0 } },
  unplannedDemand: { totalHours: 0, byCategory: { B1: 0, B2: 0, CM: 0, NCS: 0 } },
  manualAdditionalDemand: { B1: 0, B2: 0, CM: 0, NCS: 0 },
  transitOccurrences: 0, pdcOccurrences: 0,
};

describe("rosterPlanningService.getManpowerPlan", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveAirlineId.mockResolvedValue("airline-1");
    rosterGenerationService.daysInMonth.mockReturnValue(3);
    rosterGenerationService.dateAt.mockImplementation((monthKey, day) => new Date(2026, 8, day));
    leaveRepo.approvedLeaveForStaffInRange.mockResolvedValue([]);
  });

  // Each category previously took its OWN independently-worst day (B1's
  // worst day might be day 1, CM's worst day might be day 2), and those
  // two independent peaks were summed as Grand Needed as if both happened
  // on the same shift simultaneously — which this scenario deliberately
  // makes impossible: B1 peaks at 5 on day 1 (where CM is only 1 that day),
  // CM peaks at 5 on day 2 (where B1 is only 1 that day). No day in the
  // month ever actually needs 5 B1 AND 5 CM on the Morning shift at once;
  // the real worst Morning ever gets is day 1 or day 2, each needing 6
  // combined, not the 10 the old independent-peak-summing produced.
  it("uses the single highest-combined-demand day's own numbers, not each category's independent worst day", async () => {
    rosterRepo.getActiveStaffForGeneration.mockResolvedValue([
      { id: "s1", category: "B1" },
      { id: "s2", category: "CM" },
      { id: "s3", category: "NCS" },
      { id: "s4", category: "NCS" },
    ]);
    complianceService.getComplianceSummary.mockResolvedValue({ isBlocked: false });

    const advisoryDemand = {
      1: { M: { B1: 5, B2: 0, CM: 1, NCS: 0 }, A: EMPTY_SHIFT, N: EMPTY_SHIFT },
      2: { M: { B1: 1, B2: 0, CM: 5, NCS: 0 }, A: EMPTY_SHIFT, N: EMPTY_SHIFT },
      3: { M: { B1: 2, B2: 0, CM: 2, NCS: 0 }, A: EMPTY_SHIFT, N: EMPTY_SHIFT },
    };
    rosterGenerationService.buildWorkloadContext.mockResolvedValue({ advisoryDemand, ...emptyWorkloadContextFields });

    const plan = await getManpowerPlan("station-1", "2026-09", 0, { sub: "actor-1" });

    // The old (buggy) behavior would report target.M = 5 (B1's own peak) +
    // 5 (CM's own peak) = 10. The fix reports the single day's real
    // combined total: day 1 (B1 5 + CM 1 = 6) and day 2 (B1 1 + CM 5 = 6)
    // tie at 6, both strictly higher than day 3's 4 — never 10.
    expect(plan.target.M).toBe(6);
    expect(plan.target.M).not.toBe(10);
    // The reported B1/CM split must be a REAL day's actual pair, not each
    // category's own independent maximum stitched together.
    expect(plan.peak.M.b1 + plan.peak.M.cm).toBe(6);
    expect([plan.peak.M.b1, plan.peak.M.cm]).not.toEqual([5, 5]);
    expect(plan.peakDay.M).toBeGreaterThanOrEqual(1);
    expect(plan.peakDay.M).toBeLessThanOrEqual(2);
    expect(plan.grandNeeded).toBe(6);
  });

  it("excludes staff on approved leave from effectiveStaff, same as compliance-blocked staff", async () => {
    rosterRepo.getActiveStaffForGeneration.mockResolvedValue([
      { id: "s1", category: "B1" },
      { id: "s2", category: "CM" },
      { id: "s3", category: "NCS" },
      { id: "s4", category: "NCS" },
    ]);
    complianceService.getComplianceSummary.mockImplementation(async (userId) => ({ isBlocked: userId === "s2" }));
    leaveRepo.approvedLeaveForStaffInRange.mockResolvedValue([{ userId: "s4", fromDate: new Date(), toDate: new Date() }]);

    const advisoryDemand = { 1: { M: EMPTY_SHIFT, A: EMPTY_SHIFT, N: EMPTY_SHIFT } };
    rosterGenerationService.buildWorkloadContext.mockResolvedValue({ advisoryDemand, ...emptyWorkloadContextFields });

    const plan = await getManpowerPlan("station-1", "2026-09", 0, { sub: "actor-1" });

    // 4 total staff - 1 compliance-blocked (s2) - 1 on approved leave (s4) = 2.
    expect(plan.effectiveStaff).toBe(2);
    expect(plan.blockedCount).toBe(1);
    expect(plan.onLeaveCount).toBe(1);
  });

  it("does not double-subtract a staff member who is both compliance-blocked and on approved leave", async () => {
    rosterRepo.getActiveStaffForGeneration.mockResolvedValue([
      { id: "s1", category: "B1" },
      { id: "s2", category: "CM" },
    ]);
    complianceService.getComplianceSummary.mockImplementation(async (userId) => ({ isBlocked: userId === "s2" }));
    leaveRepo.approvedLeaveForStaffInRange.mockResolvedValue([{ userId: "s2", fromDate: new Date(), toDate: new Date() }]);

    const advisoryDemand = { 1: { M: EMPTY_SHIFT, A: EMPTY_SHIFT, N: EMPTY_SHIFT } };
    rosterGenerationService.buildWorkloadContext.mockResolvedValue({ advisoryDemand, ...emptyWorkloadContextFields });

    const plan = await getManpowerPlan("station-1", "2026-09", 0, { sub: "actor-1" });

    // s2 is both blocked and on leave — still only removes ONE head, not two.
    expect(plan.effectiveStaff).toBe(1);
  });
});
