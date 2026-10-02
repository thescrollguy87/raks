// End-to-end coverage (service + pure algorithm wired together) for
// "Continue from Previous Roster" actually continuing each staff member's
// REAL rotation/pattern phase on day 1 of the new month, not just
// suppressing an immediately-illegal sequence — see rosterGenerationAlgorithm
// .js's resyncCycleStart and rosterGenerationService.js's buildContinuationTails
// for the full rationale (a real dispatcher-reported gap: staff who'd
// genuinely finished an OFF block the day before month-end were coming back
// as idle on day 1 instead of straight into their next duty shift).
jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/repositories/rosterPlanningRepository");
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

describe("generateRoster — Continue from Previous Roster resyncs the actual rotation phase", () => {
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
  });

  it("continues straight into duty on day 1 for a staff member whose real previous month ended mid-rest, instead of re-idling them per the pure day-anchor formula", () => {
    return (async () => {
      // Previous month (September) roster: this staff member's real last 3
      // days were O, O, N (oldest->newest reading left to right as stored;
      // sorted by date desc inside buildContinuationTails, so shiftDate
      // ordering here just needs to be chronological).
      rosterRepo.findRosterByStationAndMonth.mockImplementation((stationId, monthKey) => {
        if (monthKey === "2026-09") return Promise.resolve({ id: "prev-roster" });
        return Promise.resolve(null); // no existing Oct roster to overwrite
      });
      rosterRepo.getRosterGrid.mockImplementation((stationId, rosterId) => {
        if (rosterId !== "prev-roster") return Promise.resolve([]);
        return Promise.resolve([{
          id: "ncs_0",
          shiftAssignments: [
            { shiftDate: new Date("2026-09-28T00:00:00.000Z"), shiftDef: { code: "N" } },
            { shiftDate: new Date("2026-09-29T00:00:00.000Z"), shiftDef: { code: "O" } },
            { shiftDate: new Date("2026-09-30T00:00:00.000Z"), shiftDef: { code: "O" } },
          ],
        }]);
      });

      // generateRoster's preview mode doesn't expose raw per-day assignment
      // codes (only aggregate counts) — only the persisted path does, via
      // rosterRepo.bulkUpsertAssignments — so apply (non-preview) is used
      // here and the written rows are decoded back from shiftDefId to code.
      rosterRepo.createRoster.mockResolvedValue({ id: "new-roster" });
      const codeById = Object.fromEntries(SHIFT_DEFS.map(d => [d.id, d.code]));
      const dayOneCode = async (continueFromPrevious) => {
        rosterRepo.bulkUpsertAssignments.mockClear();
        await generateRoster("station-1", "2026-10", ACTOR, null, { continueFromPrevious });
        const rows = rosterRepo.bulkUpsertAssignments.mock.calls[0][0];
        const day1Row = rows.find(r => r.userId === "ncs_0" && r.shiftDate.getUTCDate() === 1);
        return codeById[day1Row.shiftDefId];
      };

      const day1With = await dayOneCode(true);
      const day1Without = await dayOneCode(false);

      // The real tail (...N, O, O) means this person had already served both
      // rest days by month-end — day 1 of October must pick the rotation
      // back up on duty (M, per ROTATION's own ordering right after its two
      // O slots), not whatever the uninterrupted day-anchor formula alone
      // would have proposed.
      expect(day1With).toBe("M");
      // Only assert divergence if the day-anchor formula actually would have
      // disagreed here — guards the test against becoming a tautology if the
      // anchor math for this exact month ever coincidentally lines up.
      if (day1Without !== "M") expect(day1With).not.toBe(day1Without);
    })();
  });
});
