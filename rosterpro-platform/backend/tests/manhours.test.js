jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/repositories/leaveRepository");
jest.mock("../src/services/complianceService");
jest.mock("../src/services/workloadConfigService");
jest.mock("../src/services/ruleBuilderService");
jest.mock("../src/services/flightScheduleService");
jest.mock("../src/utils/auditTrail");

const rosterRepo = require("../src/repositories/rosterRepository");
const leaveRepo = require("../src/repositories/leaveRepository");
const complianceService = require("../src/services/complianceService");
const workloadConfigService = require("../src/services/workloadConfigService");
const ruleBuilderService = require("../src/services/ruleBuilderService");
const flightScheduleService = require("../src/services/flightScheduleService");
const { generateRoster } = require("../src/services/rosterGenerationService");

const BASE_CONFIG = {
  transitMinutesDefault: 40, pdcMinutesBeforeDeparture: 60, clashProximityMinutes: 60,
  transitVsPdcThresholdMinutes: 120, movementsPerB1Staff: 4, movementsPerCMStaff: 1, movementsPerNCSStaff: 1,
  unplannedMethod: "frequency", unplannedBufferPct: 0,
  unplannedHoursB1: 0, unplannedHoursB2: 0, unplannedHoursCM: 0, unplannedHoursNCS: 0,
  bufferB1: 0, bufferB2: 0, bufferCM: 0, bufferNCS: 0,
};
const EMPTY_MANDATORY_CONFIG = {
  B1: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
  B2: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
  CM: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
  NCS: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
};
// Real-looking shift definitions with a non-trivial Night wrap and a break,
// so the test can't pass by accident with a flat "assume 8h" shortcut.
const SHIFT_DEFS = [
  { id: "sd_m", code: "M", startTime: "06:30", endTime: "14:00", breakMin: 30, type: "duty" },
  { id: "sd_a", code: "A", startTime: "13:30", endTime: "21:30", breakMin: 30, type: "duty" },
  { id: "sd_n", code: "N", startTime: "21:00", endTime: "07:00", breakMin: 30, type: "night" },
  { id: "sd_o", code: "O", startTime: null, endTime: null, breakMin: 0, type: "off" },
  { id: "sd_l", code: "L", startTime: null, endTime: null, breakMin: 0, type: "leave" },
];
const ACTOR = { sub: "actor-1", roles: ["STATION_MANAGER"], airlineId: "airline-1" }; // not SUPER_ADMIN -> resolveAirlineId skips any DB lookup

describe("generateRoster — manhours.expected vs manhours.available", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(null);
    rosterRepo.findAllShiftDefs.mockResolvedValue(SHIFT_DEFS);
    complianceService.getComplianceSummary.mockResolvedValue({ isBlocked: false });
    leaveRepo.approvedLeaveForStaffInRange.mockResolvedValue([]);
    workloadConfigService.getWorkloadConfig.mockResolvedValue({ ...BASE_CONFIG });
    workloadConfigService.getMandatoryCoverageConfigForGeneration.mockResolvedValue(EMPTY_MANDATORY_CONFIG);
    workloadConfigService.listPlannedTasks.mockResolvedValue([]);
    workloadConfigService.listUnplannedTasks.mockResolvedValue([]);
    workloadConfigService.listManualDemand.mockResolvedValue([]);
    ruleBuilderService.listRules.mockResolvedValue([]);
    ruleBuilderService.getStaffGroupMembersByGroupId.mockResolvedValue({});
    ruleBuilderService.getStaffGroupNameById.mockResolvedValue({});
    flightScheduleService.getFlightScheduleForMonth.mockResolvedValue(null);
    rosterRepo.findStationById.mockResolvedValue({ iataCode: "AMD" });
  });

  it("reports real scheduled hours (available) even when demand (expected) is zero — not derived from each other", () => {
    return (async () => {
      rosterRepo.getActiveStaffForGeneration.mockResolvedValue([{ id: "b1_0", category: "B1" }]);
      const result = await generateRoster("station-1", "2026-09", ACTOR, null, { preview: true });

      expect(result.manhours).toBeDefined();
      // No mandatory floor, no flight schedule, no task master -> zero real demand.
      expect(result.manhours.expected.total).toBe(0);
      expect(result.manhours.expected.byCategory.B1).toBe(0);
      // Cross-check against manpowerByShift (the real per-shift headcount-days
      // the same `assignments` already produced, aggregated independently) —
      // M: 06:30-14:00 - 0.5h break = 7h; A: 13:30-21:30 - 0.5h = 7.5h; N: 21:00-07:00 - 0.5h = 9.5h.
      // Not hardcoding the exact day count: the rotation's absoluteDayAnchor
      // depends on real days-since-epoch for Sept 1 2026, not just offset 0.
      const expectedAvailable = Math.round(((result.manpowerByShift.M.B1 || 0) * 7 + (result.manpowerByShift.A.B1 || 0) * 7.5 + (result.manpowerByShift.N.B1 || 0) * 9.5) * 10) / 10;
      expect(expectedAvailable).toBeGreaterThan(0); // sanity: the rotation does put this person on SOME real duty this month
      expect(result.manhours.available.byCategory.B1).toBe(expectedAvailable);
      expect(result.manhours.available.total).toBe(expectedAvailable);
    })();
  });

  it("never counts an OFF/Leave day's hours even if its Shift Definition row carried stray timings", () => {
    return (async () => {
      const staleOffDef = [...SHIFT_DEFS];
      staleOffDef[3] = { ...staleOffDef[3], startTime: "00:00", endTime: "08:00" }; // "O" with leftover times, type still "off"
      rosterRepo.findAllShiftDefs.mockResolvedValue(staleOffDef);
      rosterRepo.getActiveStaffForGeneration.mockResolvedValue([{ id: "b1_0", category: "B1" }]);
      const result = await generateRoster("station-1", "2026-09", ACTOR, null, { preview: true });
      // Still exactly the M/A/N contribution — the "O" days contribute 0
      // despite the stray timings, because type is "off".
      const expectedAvailable = Math.round(((result.manpowerByShift.M.B1 || 0) * 7 + (result.manpowerByShift.A.B1 || 0) * 7.5 + (result.manpowerByShift.N.B1 || 0) * 9.5) * 10) / 10;
      expect(result.manhours.available.total).toBe(expectedAvailable);
    })();
  });

  it("scales expected hours with a configured mandatory floor, using the real shift duration (not a flat 8h assumption)", () => {
    return (async () => {
      workloadConfigService.getMandatoryCoverageConfigForGeneration.mockResolvedValue({
        ...EMPTY_MANDATORY_CONFIG,
        B1: { M: { enabled: false }, A: { enabled: false }, N: { enabled: true, min: 1 } },
      });
      rosterRepo.getActiveStaffForGeneration.mockResolvedValue([{ id: "b1_0", category: "B1" }]);
      const result = await generateRoster("station-1", "2026-09", ACTOR, null, { preview: true });
      const nDays = 30; // September
      // Night floor of 1, every day, at the real 9.5h Night duration (10h - 0.5h break).
      expect(result.manhours.expected.byCategory.B1).toBe(nDays * 9.5);
      expect(result.manhours.expected.total).toBe(nDays * 9.5);
    })();
  });
});
