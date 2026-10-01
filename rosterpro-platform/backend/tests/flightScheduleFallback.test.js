jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/services/workloadConfigService");
jest.mock("../src/services/ruleBuilderService");
jest.mock("../src/services/flightScheduleService");

const rosterRepo = require("../src/repositories/rosterRepository");
const workloadConfigService = require("../src/services/workloadConfigService");
const ruleBuilderService = require("../src/services/ruleBuilderService");
const flightScheduleService = require("../src/services/flightScheduleService");
const { decodeDaysOfWeek } = require("../src/utils/flightScheduleParser");
const { buildWorkloadContext } = require("../src/services/rosterGenerationService");

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

// A turn record scoped to AUGUST 2026 (daysOfWeek "operates every day"),
// as if it had been imported and saved for that month — its own
// effectiveDate/discontinueDate only cover August.
function augustTurnRecord() {
  return {
    inboundFlt: "IN", outboundFlt: "OUT", outboundDepSta: "AMD", inboundArrSta: "AMD",
    inboundArrMin: 9 * 60, outboundDepMin: 9 * 60 + 40, groundTimeMin: 40,
    effectiveDate: new Date(2026, 7, 1), discontinueDate: new Date(2026, 7, 31),
    daysOfWeek: decodeDaysOfWeek(1234567),
  };
}

describe("buildWorkloadContext — previous-month flight schedule fallback (Section 4.6)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    workloadConfigService.getWorkloadConfig.mockResolvedValue({ ...BASE_CONFIG });
    workloadConfigService.getMandatoryCoverageConfigForGeneration.mockResolvedValue(EMPTY_MANDATORY_CONFIG);
    workloadConfigService.listPlannedTasks.mockResolvedValue([]);
    workloadConfigService.listUnplannedTasks.mockResolvedValue([]);
    workloadConfigService.listManualDemand.mockResolvedValue([]);
    ruleBuilderService.listRules.mockResolvedValue([]);
    ruleBuilderService.getStaffGroupMembersByGroupId.mockResolvedValue({});
    ruleBuilderService.getStaffGroupNameById.mockResolvedValue({});
    rosterRepo.findAllShiftDefs.mockResolvedValue([
      { code: "M", startTime: "06:00", endTime: "14:00", type: "morning" },
      { code: "A", startTime: "14:00", endTime: "22:00", type: "afternoon" },
      { code: "N", startTime: "22:00", endTime: "06:00", type: "night" },
    ]);
    rosterRepo.findStationById.mockResolvedValue({ iataCode: "AMD" });
  });

  it("uses the previous month's imported flight schedule when none exists for the target month", async () => {
    flightScheduleService.getFlightScheduleForMonth.mockImplementation((stationId, year, month) => {
      if (year === 2026 && month === 9) return Promise.resolve(null); // nothing imported for September
      if (year === 2026 && month === 8) return Promise.resolve({ turnRecords: [augustTurnRecord()], charterRecords: [] }); // August exists
      return Promise.resolve(null);
    });
    const ctx = await buildWorkloadContext("station-1", "2026-09", undefined, 0, "airline-1");
    expect(ctx.flightScheduleFallback).toEqual({ used: true, fromMonthKey: "2026-08" });
    expect(ctx.demandSource).toBe("flight-schedule-driven");
    expect(ctx.demandReason).toMatch(/No flight schedule imported for 2026-09.*2026-08.*fallback/);
    // The August record's daily-operating pattern, re-applied onto September's
    // real calendar, should produce real operating days for September — not
    // zero, the way flat base-coverage-only would.
    expect(ctx.flightSummary.operatingDays).toBeGreaterThan(0);
  });

  it("does NOT fall back when the target month's own flight schedule exists", async () => {
    const septRecord = { ...augustTurnRecord(), effectiveDate: new Date(2026, 8, 1), discontinueDate: new Date(2026, 8, 30) };
    flightScheduleService.getFlightScheduleForMonth.mockImplementation((stationId, year, month) => {
      if (year === 2026 && month === 9) return Promise.resolve({ turnRecords: [septRecord], charterRecords: [] });
      return Promise.resolve(null);
    });
    const ctx = await buildWorkloadContext("station-1", "2026-09", undefined, 0, "airline-1");
    expect(ctx.flightScheduleFallback).toBeNull();
    // Previous month must never even be queried when the target month's own data exists.
    expect(flightScheduleService.getFlightScheduleForMonth).toHaveBeenCalledTimes(1);
  });

  it("falls back to flat base-coverage-only when NEITHER the target nor the previous month has an import", async () => {
    flightScheduleService.getFlightScheduleForMonth.mockResolvedValue(null);
    const ctx = await buildWorkloadContext("station-1", "2026-09", undefined, 0, "airline-1");
    expect(ctx.flightScheduleFallback).toBeNull();
    expect(ctx.demandSource).toBe("base-coverage-only");
  });
});
