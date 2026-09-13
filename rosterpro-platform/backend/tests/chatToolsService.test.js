// Unit tests for the Roster Assistant's tool layer. Every underlying real
// service/repository is mocked here (this is a test of chatToolsService's
// own composition/shaping logic, not a re-test of buildWorkloadContext,
// ruleEngine, etc. — those already have their own test files) — but the
// mocks are asserted on to prove each tool actually calls the real
// function it claims to, with the caller's real session scope, and never
// invents a number itself.
jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/repositories/leaveRepository");
jest.mock("../src/services/workloadConfigService");
jest.mock("../src/services/ruleBuilderService");
jest.mock("../src/services/flightScheduleService");
jest.mock("../src/services/departureAllocationService");
jest.mock("../src/services/rosterGenerationService");
jest.mock("../src/utils/ruleEngine");

const rosterRepo = require("../src/repositories/rosterRepository");
const leaveRepo = require("../src/repositories/leaveRepository");
const workloadConfigService = require("../src/services/workloadConfigService");
const ruleBuilderService = require("../src/services/ruleBuilderService");
const flightScheduleService = require("../src/services/flightScheduleService");
const departureAllocationService = require("../src/services/departureAllocationService");
const rosterGenerationService = require("../src/services/rosterGenerationService");
const ruleEngine = require("../src/utils/ruleEngine");
const chatTools = require("../src/services/chatToolsService");

// A plain station-scoped actor — assertOwnStation (real, unmocked) passes
// this straight through with no DB call as long as stationId matches, so
// these tests exercise the real security boundary too, not a stub of it.
const STATION_ID = "station-1";
const AIRLINE_ID = "airline-1";
const ctx = (overrides = {}) => ({
  actor: { sub: "user-1", name: "Test User", stationId: STATION_ID, airlineId: AIRLINE_ID, roles: ["STATION_MANAGER"] },
  stationId: STATION_ID, airlineId: AIRLINE_ID, req: { ip: "127.0.0.1" },
  ...overrides,
});

const SHIFT_DEFS = [
  { code: "M", type: "duty", startTime: "06:30", endTime: "14:00" },
  { code: "A", type: "duty", startTime: "13:30", endTime: "21:30" },
  { code: "N", type: "night", startTime: "21:00", endTime: "07:00" },
];

function staffRow({ id, fullName, category, shifts }) {
  return {
    id, fullName, category, designation: "AME",
    shiftAssignments: shifts.map(([date, code]) => ({
      shiftDate: new Date(`${date}T00:00:00.000Z`),
      shiftDef: SHIFT_DEFS.find(d => d.code === code) || { code, name: code, startTime: null, endTime: null },
    })),
  };
}

beforeEach(() => {
  rosterRepo.findAllShiftDefs.mockResolvedValue(SHIFT_DEFS);
});

describe("getCategoryRequirement", () => {
  it("reports the higher of the mandatory floor and advisory target per category, vs who's actually on duty", async () => {
    rosterGenerationService.buildWorkloadContext.mockResolvedValue({
      mandatoryCoverageConfig: { B1: { N: { enabled: true, min: 1 } }, CM: { N: { enabled: false } } },
      advisoryDemand: { 9: { N: { B1: 3, CM: 2, NCS: 4 } } },
      demandSource: "flight-schedule-driven",
    });
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([
      staffRow({ id: "s1", fullName: "A", category: "B1", shifts: [["2026-09-09", "N"]] }),
      staffRow({ id: "s2", fullName: "B", category: "B1", shifts: [["2026-09-09", "N"]] }),
      staffRow({ id: "s3", fullName: "C", category: "CM", shifts: [["2026-09-09", "N"]] }),
    ]);

    const result = await chatTools.getCategoryRequirement({ date: "2026-09-09", shift: "Night" }, ctx());

    const b1 = result.categories.find(c => c.category === "B1");
    // Mandatory min=1 but advisory target=3 -> required is the HIGHER one (3), not the mandatory floor alone.
    expect(b1).toEqual({ category: "B1", required: 3, available: 2, status: "SHORT", shortfall: 1 });
    const cm = result.categories.find(c => c.category === "CM");
    expect(cm).toEqual({ category: "CM", required: 2, available: 1, status: "SHORT", shortfall: 1 });
    expect(rosterGenerationService.buildWorkloadContext).toHaveBeenCalledWith(STATION_ID, "2026-09", undefined, 0, AIRLINE_ID);
  });

  it("never leaks another station's data — args cannot override the session stationId", async () => {
    rosterGenerationService.buildWorkloadContext.mockResolvedValue({ mandatoryCoverageConfig: {}, advisoryDemand: {} });
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(null);
    // The tool's own signature has nowhere to accept a stationId — passing
    // one in args (as a hostile/confused model might) is simply ignored.
    await chatTools.getCategoryRequirement({ date: "2026-09-09", shift: "N", stationId: "some-other-station" }, ctx());
    expect(rosterGenerationService.buildWorkloadContext).toHaveBeenCalledWith(STATION_ID, "2026-09", undefined, 0, AIRLINE_ID);
  });
});

describe("getMandatoryCoverageStatus", () => {
  it("reports the mandatory floor ALONE, ignoring advisory sizing entirely", async () => {
    workloadConfigService.getMandatoryCoverageConfigForGeneration.mockResolvedValue({
      B1: { N: { enabled: true, min: 2 } },
    });
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([
      staffRow({ id: "s1", fullName: "A", category: "B1", shifts: [["2026-09-09", "N"]] }),
    ]);

    const result = await chatTools.getMandatoryCoverageStatus({ date: "2026-09-09", shift: "N" }, ctx());
    expect(result.categories).toEqual([{ category: "B1", minRequired: 2, actual: 1, met: false }]);
    expect(result.allMet).toBe(false);
    // This function never even calls buildWorkloadContext (no advisory demand involved).
    expect(rosterGenerationService.buildWorkloadContext).not.toHaveBeenCalled();
  });
});

describe("getShiftRoster", () => {
  it("returns real published-roster entries for the date, filtered by category when given", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1", isPublished: true });
    rosterRepo.getRosterGrid.mockResolvedValue([
      staffRow({ id: "s1", fullName: "Alice", category: "B1", shifts: [["2026-09-09", "N"]] }),
      staffRow({ id: "s2", fullName: "Bob", category: "NCS", shifts: [["2026-09-09", "N"]] }),
    ]);
    const result = await chatTools.getShiftRoster({ date: "2026-09-09", category: "B1" }, ctx());
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].fullName).toBe("Alice");
  });

  it("reports no roster published rather than guessing when none exists", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(null);
    const result = await chatTools.getShiftRoster({ date: "2026-09-09" }, ctx());
    expect(result.rosterPublished).toBe(false);
    expect(result.entries).toEqual([]);
    expect(rosterRepo.getRosterGrid).not.toHaveBeenCalled();
  });
});

describe("getDepartureManpower", () => {
  it("delegates straight to the real departureAllocationService with the actor, and surfaces the real unfilled reason", async () => {
    departureAllocationService.getDayAllocation.mockResolvedValue([
      {
        flightRef: "QP-101", depTime: "06:00", shiftCode: "M",
        releaser: null, releaserUnfilledReason: "all_busy_with_clash",
        support: { fullName: "Bob" }, supportUnfilledReason: null,
      },
    ]);
    const result = await chatTools.getDepartureManpower({ date: "2026-09-10" }, ctx());
    expect(departureAllocationService.getDayAllocation).toHaveBeenCalledWith(STATION_ID, 2026, 9, 10, ctx().actor);
    expect(result.departures[0].releaserUnfilledReason).toBe("all_busy_with_clash");
    expect(result.departures[0].releaser).toBeNull();
  });
});

describe("getTaskMasterStatus", () => {
  it("lists exactly the zero-frequency entries, real names only", async () => {
    workloadConfigService.listPlannedTasks.mockResolvedValue([
      { name: "Layover Inspection", frequency: 0 },
      { name: "A-Check", frequency: 12 },
    ]);
    workloadConfigService.listUnplannedTasks.mockResolvedValue([
      { name: "Wheel Change", avgFreqPerMonth: 0 },
    ]);
    const result = await chatTools.getTaskMasterStatus({}, ctx());
    expect(result.zeroFrequencyPlannedTasks).toEqual(["Layover Inspection"]);
    expect(result.zeroFrequencyUnplannedTasks).toEqual(["Wheel Change"]);
    expect(result.fullyConfigured).toBe(false);
  });
});

describe("getComplianceStatus", () => {
  it("calls the real checkHardRuleCompliance against the published roster and filters to the requested range", async () => {
    ruleBuilderService.listRules.mockResolvedValue([{ id: "r1", name: "Min rest" }]);
    ruleBuilderService.getStaffGroupMembersByGroupId.mockResolvedValue({});
    ruleBuilderService.getStaffGroupNameById.mockResolvedValue({});
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([
      staffRow({ id: "s1", fullName: "Alice", category: "B1", shifts: [["2026-09-09", "N"], ["2026-09-10", "M"]] }),
    ]);
    rosterGenerationService.buildStaffWithShifts.mockReturnValue([{ id: "s1", category: "B1", shifts: ["N", "M"] }]);
    rosterGenerationService.buildRuleShiftDefsByCode.mockReturnValue({ N: { type: "night" }, M: { type: "duty" } });
    rosterGenerationService.daysInMonth.mockReturnValue(30);
    rosterGenerationService.dateAt.mockImplementation((monthKey, day) => new Date(`2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`));
    ruleEngine.checkHardRuleCompliance.mockReturnValue([
      { staff: "s1", day: 2, shift: "M", rule: "Min rest", reason: "Morning after Night" },
    ]);

    const result = await chatTools.getComplianceStatus({ dateRangeStart: "2026-09-01", dateRangeEnd: "2026-09-30" }, ctx());
    expect(ruleEngine.checkHardRuleCompliance).toHaveBeenCalled();
    expect(result.violations).toEqual([{ date: "2026-09-02", staffName: "Alice", shift: "M", rule: "Min rest", reason: "Morning after Night" }]);
  });
});

describe("getStaffNightCount", () => {
  it("resolves the name against the real active-staff list and counts only real Night shifts in range", async () => {
    rosterRepo.getActiveStaffForGeneration.mockResolvedValue([
      { id: "s1", fullName: "Alice Smith", category: "B1" },
    ]);
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([
      staffRow({ id: "s1", fullName: "Alice Smith", category: "B1", shifts: [["2026-09-01", "N"], ["2026-09-02", "N"], ["2026-09-03", "M"]] }),
    ]);
    const result = await chatTools.getStaffNightCount({ staffName: "alice", dateRangeStart: "2026-09-01", dateRangeEnd: "2026-09-30" }, ctx());
    expect(result.nightShiftCount).toBe(2);
    expect(result.staffName).toBe("Alice Smith");
  });

  it("returns a clear error instead of guessing when the name doesn't resolve uniquely", async () => {
    rosterRepo.getActiveStaffForGeneration.mockResolvedValue([
      { id: "s1", fullName: "Alice Smith", category: "B1" },
      { id: "s2", fullName: "Alice Jones", category: "CM" },
    ]);
    const result = await chatTools.getStaffNightCount({ staffName: "alice", dateRangeStart: "2026-09-01" }, ctx());
    expect(result.error).toBe(true);
    expect(result.reason).toMatch(/more than one/i);
  });
});

describe("getLeaveForDate", () => {
  it("calls the real approvedLeaveForStaffInRange with the station's actual active staff", async () => {
    rosterRepo.getActiveStaffForGeneration.mockResolvedValue([{ id: "s1", fullName: "Alice", category: "B1" }]);
    leaveRepo.approvedLeaveForStaffInRange.mockResolvedValue([{ userId: "s1" }]);
    const result = await chatTools.getLeaveForDate({ date: "2026-09-09" }, ctx());
    expect(result.onLeave).toEqual([{ fullName: "Alice", category: "B1" }]);
  });
});

describe("listStaff", () => {
  it("searches the real active-staff list by name substring and category", async () => {
    rosterRepo.getActiveStaffForGeneration.mockResolvedValue([
      { id: "s1", fullName: "Alice Smith", category: "B1", designation: "AME" },
      { id: "s2", fullName: "Bob Jones", category: "CM", designation: "Tech" },
    ]);
    const result = await chatTools.listStaff({ nameQuery: "ali" }, ctx());
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].fullName).toBe("Alice Smith");
  });
});
