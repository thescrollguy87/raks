jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/services/workloadConfigService");
jest.mock("../src/services/ruleBuilderService");
jest.mock("../src/services/flightScheduleService");

const rosterRepo = require("../src/repositories/rosterRepository");
const workloadConfigService = require("../src/services/workloadConfigService");
const ruleBuilderService = require("../src/services/ruleBuilderService");
const flightScheduleService = require("../src/services/flightScheduleService");
const { buildWorkloadContext } = require("../src/services/rosterGenerationService");

const BASE_CONFIG = {
  transitMinutesDefault: 40, pdcMinutesBeforeDeparture: 60, clashProximityMinutes: 60,
  transitVsPdcThresholdMinutes: 120, movementsPerB1Staff: 4, movementsPerCMStaff: 1, movementsPerNCSStaff: 1,
  unplannedMethod: "frequency", unplannedBufferPct: 20,
  unplannedHoursB1: 0, unplannedHoursB2: 0, unplannedHoursCM: 0, unplannedHoursNCS: 0,
  bufferB1: 0, bufferB2: 0, bufferCM: 0, bufferNCS: 0,
};
const EMPTY_MANDATORY_CONFIG = {
  B1: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
  B2: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
  CM: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
  NCS: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
};

describe("buildWorkloadContext — AOG Buffer redesign (monthly man-hours, all 4 categories)", () => {
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
    flightScheduleService.getFlightScheduleForMonth.mockResolvedValue(null);
    rosterRepo.findAllShiftDefs.mockResolvedValue([
      { code: "M", startTime: "06:00", endTime: "14:00", type: "morning" },
      { code: "A", startTime: "14:00", endTime: "22:00", type: "afternoon" },
      { code: "N", startTime: "22:00", endTime: "06:00", type: "night" },
    ]);
    rosterRepo.findStationById.mockResolvedValue({ iataCode: "AMD" });
  });

  it("converts N days into man-hours (days x 24h) and applies the SAME per-shift headcount identically to B1, B2, CM, and NCS — not B1 only", async () => {
    // 30 AOG-buffer days in a 30-day month = 720h total, / 30 days / 8h per
    // shift = 3 extra heads per shift — the same 3, every shift, every
    // category, since it's a flat monthly total spread evenly, not a
    // per-shift or B1-only number.
    const ctx = await buildWorkloadContext("station-1", "2026-09", undefined, 30, "airline-1");
    expect(ctx.aogPerShift).toBe(3);
    for (const d of [1, 15, 30]) {
      for (const sh of ["M", "A", "N"]) {
        expect(ctx.advisoryDemand[d][sh].B1).toBe(3);
        expect(ctx.advisoryDemand[d][sh].B2).toBe(3);
        expect(ctx.advisoryDemand[d][sh].CM).toBe(3);
        expect(ctx.advisoryDemand[d][sh].NCS).toBe(3);
      }
    }
  });

  it("adds zero when no AOG buffer is given", async () => {
    const ctx = await buildWorkloadContext("station-1", "2026-09", undefined, 0, "airline-1");
    expect(ctx.aogPerShift).toBe(0);
    expect(ctx.advisoryDemand[1].M.B1).toBe(0);
  });

  it("stays additive on top of the station's own configured per-shift buffer, not a replacement for it", async () => {
    workloadConfigService.getWorkloadConfig.mockResolvedValue({ ...BASE_CONFIG, bufferB1: 2, bufferCM: 1 });
    const ctx = await buildWorkloadContext("station-1", "2026-09", undefined, 30, "airline-1"); // aogPerShift = 3
    expect(ctx.advisoryDemand[1].M.B1).toBe(2 + 3);
    expect(ctx.advisoryDemand[1].M.CM).toBe(1 + 3);
    expect(ctx.advisoryDemand[1].M.NCS).toBe(0 + 3);
    expect(ctx.advisoryDemand[1].M.B2).toBe(0 + 3);
  });
});

describe("buildWorkloadContext — Unplanned flat allowance actually reaches real demand (Issue #6)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    workloadConfigService.getMandatoryCoverageConfigForGeneration.mockResolvedValue(EMPTY_MANDATORY_CONFIG);
    workloadConfigService.listPlannedTasks.mockResolvedValue([]);
    workloadConfigService.listUnplannedTasks.mockResolvedValue([]);
    workloadConfigService.listManualDemand.mockResolvedValue([]);
    ruleBuilderService.listRules.mockResolvedValue([]);
    ruleBuilderService.getStaffGroupMembersByGroupId.mockResolvedValue({});
    ruleBuilderService.getStaffGroupNameById.mockResolvedValue({});
    flightScheduleService.getFlightScheduleForMonth.mockResolvedValue(null);
    rosterRepo.findAllShiftDefs.mockResolvedValue([
      { code: "M", startTime: "06:00", endTime: "14:00", type: "morning" },
      { code: "A", startTime: "14:00", endTime: "22:00", type: "afternoon" },
      { code: "N", startTime: "22:00", endTime: "06:00", type: "night" },
    ]);
    rosterRepo.findStationById.mockResolvedValue({ iataCode: "AMD" });
  });

  it("a per-category Unplanned Manpower-Hours Allowance raises real per-day demand, not just the display total", async () => {
    // Previously this config field (unplannedManpowerHoursPerMonth, a single
    // combined number) never reached computeDailyShiftDemand at all — a
    // station could set it and see the Workload Summary panel change while
    // the actual generated roster behaved as if it were zero. 720h/month on
    // B1 split across 3 shifts over a 30-day month = 720/3/30/8 = 1 extra
    // B1 head on every shift, every day.
    workloadConfigService.getWorkloadConfig.mockResolvedValue({
      ...BASE_CONFIG, unplannedMethod: "manpower_hours", unplannedHoursB1: 720,
    });
    const ctx = await buildWorkloadContext("station-1", "2026-09", undefined, 0, "airline-1");
    expect(ctx.advisoryDemand[1].M.B1).toBe(1);
    expect(ctx.advisoryDemand[15].N.B1).toBe(1);
    expect(ctx.advisoryDemand[1].M.CM).toBe(0); // unaffected — allowance was B1-only
  });

  it("the buffer % also raises real per-day demand, scaled to each category's own planned hours", async () => {
    workloadConfigService.getWorkloadConfig.mockResolvedValue({ ...BASE_CONFIG, unplannedBufferPct: 100 });
    // 720h/month of planned B1 work -> 100% buffer adds another 720h,
    // split across 3 shifts over 30 days = 720/3/30/8 = 1 extra B1 head.
    workloadConfigService.listPlannedTasks.mockResolvedValue([
      { name: "Weekly Check", frequency: 90, frequencyUnit: "per_month", avgDurationMin: 480, reqB1: 1, reqB2: 0, reqCM: 0, reqNCS: 0, preferredShift: null },
    ]);
    const ctx = await buildWorkloadContext("station-1", "2026-09", undefined, 0, "airline-1");
    expect(ctx.advisoryDemand[1].M.B1).toBeGreaterThanOrEqual(1);
  });
});
