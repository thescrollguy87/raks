// Partial-month regeneration: fromDate/toDate let an admin re-run the
// generator over just a window (e.g. "a deputation was just added for the
// 15th onward — regenerate from the 15th to month-end") without disturbing
// already-published or hand-edited days outside it. See
// rosterGenerationAlgorithm.js's regenFromDay/regenToDay/lockedCodesByUserDay
// doc comment and rosterGenerationService.js's buildLockedCodesByUserDay for
// the full design — this covers the service-level wiring end to end.
jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/repositories/rosterPlanningRepository");
jest.mock("../src/repositories/leaveRepository");
jest.mock("../src/services/complianceService");
jest.mock("../src/services/workloadConfigService");
jest.mock("../src/services/ruleBuilderService");
jest.mock("../src/services/flightScheduleService");
jest.mock("../src/services/rosterVersionService");
jest.mock("../src/utils/auditTrail");

const rosterRepo = require("../src/repositories/rosterRepository");
const leaveRepo = require("../src/repositories/leaveRepository");
const complianceService = require("../src/services/complianceService");
const workloadConfigService = require("../src/services/workloadConfigService");
const ruleBuilderService = require("../src/services/ruleBuilderService");
const flightScheduleService = require("../src/services/flightScheduleService");
const rosterVersionService = require("../src/services/rosterVersionService");
const { generateRoster, dayOfMonthFromDate } = require("../src/services/rosterGenerationService");

const EMPTY_MANDATORY_CONFIG = {
  B1: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
  B2: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
  CM: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
  NCS: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
};
const SHIFT_DEFS = [
  { id: "sd_m", code: "M", startTime: "06:30", endTime: "14:00", breakMin: 30, type: "duty" },
  { id: "sd_a", code: "A", startTime: "13:30", endTime: "21:30", breakMin: 30, type: "duty" },
  { id: "sd_n", code: "N", startTime: "21:00", endTime: "07:00", breakMin: 30, type: "night" },
  { id: "sd_o", code: "O", startTime: null, endTime: null, breakMin: 0, type: "off" },
  { id: "sd_l", code: "L", startTime: null, endTime: null, breakMin: 0, type: "leave" },
];
const ACTOR = { sub: "actor-1", roles: ["STATION_MANAGER"], airlineId: "airline-1" };

describe("rosterGenerationService.dayOfMonthFromDate", () => {
  it("resolves a date within the target month to its day number", () => {
    expect(dayOfMonthFromDate("2026-11", "2026-11-15", "fromDate")).toBe(15);
  });
  it("rejects a date outside the target month", () => {
    expect(() => dayOfMonthFromDate("2026-11", "2026-12-01", "fromDate")).toThrow(/fromDate/);
  });
});

describe("generateRoster — partial-month regeneration (fromDate/toDate)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rosterRepo.findAllShiftDefs.mockResolvedValue(SHIFT_DEFS);
    complianceService.getComplianceSummary.mockResolvedValue({ isBlocked: false });
    leaveRepo.approvedLeaveForStaffInRange.mockResolvedValue([]);
    workloadConfigService.getWorkloadConfig.mockResolvedValue({
      transitMinutesDefault: 40, pdcMinutesBeforeDeparture: 60, clashProximityMinutes: 60,
      transitVsPdcThresholdMinutes: 120, movementsPerB1Staff: 4, movementsPerCMStaff: 1, movementsPerNCSStaff: 1,
      unplannedMethod: "frequency", unplannedBufferPct: 0,
      unplannedHoursB1: 0, unplannedHoursB2: 0, unplannedHoursCM: 0, unplannedHoursNCS: 0,
      bufferB1: 0, bufferB2: 0, bufferCM: 0, bufferNCS: 0,
    });
    workloadConfigService.getMandatoryCoverageConfigForGeneration.mockResolvedValue(EMPTY_MANDATORY_CONFIG);
    workloadConfigService.listPlannedTasks.mockResolvedValue([]);
    workloadConfigService.listUnplannedTasks.mockResolvedValue([]);
    workloadConfigService.listManualDemand.mockResolvedValue([]);
    ruleBuilderService.listRules.mockResolvedValue([]);
    ruleBuilderService.getStaffGroupMembersByGroupId.mockResolvedValue({});
    ruleBuilderService.getStaffGroupNameById.mockResolvedValue({});
    flightScheduleService.getFlightScheduleForMonth.mockResolvedValue(null);
    rosterRepo.findStationById.mockResolvedValue({ iataCode: "AMD" });
    rosterRepo.getActiveStaffForGeneration.mockResolvedValue([{ id: "ncs_0", category: "NCS" }]);
    rosterRepo.createRoster.mockResolvedValue({ id: "new-roster" });
    rosterVersionService.createVersion.mockResolvedValue({});
  });

  it("refuses a windowed regenerate when no roster exists yet for the month", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(null);
    await expect(
      generateRoster("station-1", "2026-11", ACTOR, null, { fromDate: "2026-11-15" })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects fromDate after toDate", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "existing-roster" });
    await expect(
      generateRoster("station-1", "2026-11", ACTOR, null, { fromDate: "2026-11-20", toDate: "2026-11-10" })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("only writes rows for days inside the window, leaving days outside it untouched", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "existing-roster" });
    rosterRepo.getRosterGrid.mockResolvedValue([{
      id: "ncs_0",
      shiftAssignments: Array.from({ length: 30 }, (_, i) => ({
        shiftDate: new Date(Date.UTC(2026, 10, i + 1)), shiftDef: { code: "O" },
      })),
    }]);

    await generateRoster("station-1", "2026-11", ACTOR, null, { fromDate: "2026-11-15", toDate: "2026-11-20" });

    const rows = rosterRepo.bulkUpsertAssignments.mock.calls[0][0];
    const days = rows.map(r => r.shiftDate.getUTCDate()).sort((a, b) => a - b);
    expect(days).toEqual([15, 16, 17, 18, 19, 20]);
  });

  it("honors real locked history at the seam — two real Night shifts right before the window still force the window's first two days OFF", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "existing-roster" });
    const baseDays = Array.from({ length: 30 }, (_, i) => ({
      shiftDate: new Date(Date.UTC(2026, 10, i + 1)), shiftDef: { code: "O" },
    }));
    // Real days 13 and 14 (right before the day-15 window) are Night/Night.
    baseDays[12] = { shiftDate: new Date(Date.UTC(2026, 10, 13)), shiftDef: { code: "N" } };
    baseDays[13] = { shiftDate: new Date(Date.UTC(2026, 10, 14)), shiftDef: { code: "N" } };
    rosterRepo.getRosterGrid.mockResolvedValue([{ id: "ncs_0", shiftAssignments: baseDays }]);

    await generateRoster("station-1", "2026-11", ACTOR, null, { fromDate: "2026-11-15", toDate: "2026-11-20" });

    const rows = rosterRepo.bulkUpsertAssignments.mock.calls[0][0];
    const codeById = Object.fromEntries(SHIFT_DEFS.map(d => [d.id, d.code]));
    const day15 = rows.find(r => r.shiftDate.getUTCDate() === 15);
    const day16 = rows.find(r => r.shiftDate.getUTCDate() === 16);
    expect(codeById[day15.shiftDefId]).toBe("O");
    expect(codeById[day16.shiftDefId]).toBe("O");
  });

  it("omitting fromDate/toDate still regenerates (and writes) the whole month, unchanged from before this feature existed", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(null);
    rosterRepo.getRosterGrid.mockResolvedValue([]);

    await generateRoster("station-1", "2026-11", ACTOR, null, {});

    const rows = rosterRepo.bulkUpsertAssignments.mock.calls[0][0];
    const days = new Set(rows.map(r => r.shiftDate.getUTCDate()));
    expect(days.size).toBe(30);
  });
});
