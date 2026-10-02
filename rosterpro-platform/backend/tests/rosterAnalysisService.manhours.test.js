jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/repositories/stationRepository");
jest.mock("../src/services/rosterGenerationService");

const rosterRepo = require("../src/repositories/rosterRepository");
const stationRepo = require("../src/repositories/stationRepository");
const rosterGenerationService = require("../src/services/rosterGenerationService");
const { getManhoursSummary } = require("../src/services/rosterAnalysisService");

const EXPECTED = { total: 100, byCategory: { B1: 40, B2: 10, CM: 20, NCS: 30 } };

function shiftAssignment(code, type, overrides = {}) {
  return { shiftDef: { code, type, startTime: "06:30", endTime: "14:00", breakMin: 30 }, ...overrides };
}

describe("rosterAnalysisService.getManhoursSummary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stationRepo.findStationAirlineId.mockResolvedValue({ airlineId: "airline-1" });
    rosterGenerationService.buildWorkloadContext.mockResolvedValue({ expectedManhours: EXPECTED });
  });

  it("returns expected-only (no available) when no roster exists yet for the month", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(null);
    const result = await getManhoursSummary("station-1", "2026-09");
    expect(result.generated).toBe(false);
    expect(result.expected).toEqual(EXPECTED);
    expect(result.available).toBeNull();
    expect(rosterRepo.getRosterGrid).not.toHaveBeenCalled();
  });

  it("sums real scheduled duty hours per category, applying a manual time override where one exists", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1", isPublished: true });
    rosterRepo.getRosterGrid.mockResolvedValue([
      {
        id: "b1_1", category: "B1",
        shiftAssignments: [
          shiftAssignment("M", "duty"), // plain 06:30-14:00 - 0.5h break = 7h
          shiftAssignment("M", "duty", { in1: "07:00", out1: "13:00" }), // manual override 07:00-13:00 (6h gross) - the def's own 0.5h break = 5.5h
        ],
      },
      { id: "cm_1", category: "CM", shiftAssignments: [shiftAssignment("N", "night")] },
      { id: "sto_1", category: "STO", shiftAssignments: [shiftAssignment("M", "duty")] }, // STO excluded entirely
    ]);

    const result = await getManhoursSummary("station-1", "2026-09");
    expect(result.generated).toBe(true);
    expect(result.byCategory.B1.available).toBe(12.5); // 7 + 5.5
    expect(result.byCategory.B1.expected).toBe(40);
    expect(result.total.available).toBeGreaterThan(0);
    expect(result.byCategory.STO).toBeUndefined();
  });

  it("never counts an OFF/Leave assignment's hours even if its shiftDef row carried stray start/end times", () => {
    return (async () => {
      rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1", isPublished: false });
      rosterRepo.getRosterGrid.mockResolvedValue([
        {
          id: "b1_1", category: "B1",
          shiftAssignments: [{ shiftDef: { code: "O", type: "off", startTime: "00:00", endTime: "08:00", breakMin: 0 } }],
        },
      ]);
      const result = await getManhoursSummary("station-1", "2026-09");
      expect(result.byCategory.B1.available).toBe(0);
      expect(result.total.available).toBe(0);
    })();
  });

  it("computes utilizationPct as available/expected, and null when expected is zero", async () => {
    rosterGenerationService.buildWorkloadContext.mockResolvedValue({
      expectedManhours: { total: 0, byCategory: { B1: 0, B2: 0, CM: 0, NCS: 0 } },
    });
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1", isPublished: true });
    rosterRepo.getRosterGrid.mockResolvedValue([
      { id: "b1_1", category: "B1", shiftAssignments: [shiftAssignment("M", "duty")] },
    ]);
    const result = await getManhoursSummary("station-1", "2026-09");
    expect(result.byCategory.B1.utilizationPct).toBeNull(); // no demand to divide by
    expect(result.byCategory.CM.utilizationPct).toBeNull();
  });
});
