jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/repositories/leaveRepository");
jest.mock("../src/services/workloadConfigService");

const rosterRepo = require("../src/repositories/rosterRepository");
const leaveRepo = require("../src/repositories/leaveRepository");
const workloadConfigService = require("../src/services/workloadConfigService");
const { getCoverageAnalysis } = require("../src/services/rosterAnalysisService");

function shiftAssignment(day, code, type) {
  return { shiftDate: new Date(Date.UTC(2026, 8, day)), shiftDef: { code, type } };
}

const DEFAULT_RULES = [
  { category: "B1", shift: "M", enabled: true, minCount: 1 },
  { category: "B1", shift: "A", enabled: true, minCount: 1 },
  { category: "B1", shift: "N", enabled: true, minCount: 1 },
  { category: "B2", shift: "M", enabled: false, minCount: 1 },
  { category: "B2", shift: "A", enabled: false, minCount: 1 },
  { category: "B2", shift: "N", enabled: true, minCount: 1 },
  { category: "CM", shift: "M", enabled: false, minCount: 1 },
  { category: "CM", shift: "A", enabled: false, minCount: 1 },
  { category: "CM", shift: "N", enabled: true, minCount: 2 },
  { category: "NCS", shift: "M", enabled: false, minCount: 1 },
  { category: "NCS", shift: "A", enabled: false, minCount: 1 },
  { category: "NCS", shift: "N", enabled: false, minCount: 1 },
];

describe("rosterAnalysisService.getCoverageAnalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    leaveRepo.approvedLeaveForStaffInRange.mockResolvedValue([]);
    workloadConfigService.listMandatoryCoverageRules.mockResolvedValue(DEFAULT_RULES);
  });

  it("reports no roster generated when none exists for the month", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(null);
    const result = await getCoverageAnalysis("station-1", "2026-09");
    expect(result.generated).toBe(false);
    expect(result.message).toMatch(/No roster has been generated/);
    expect(rosterRepo.getRosterGrid).not.toHaveBeenCalled();
  });

  it("flags a chronic CM Night shortfall as a structural headcount shortage, not a one-off", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1", isPublished: false });
    // 2 CM total, both only ever cover Night on alternating days (1 at a
    // time) against a floor of 2 — genuinely can't be fixed by rescheduling.
    rosterRepo.getRosterGrid.mockResolvedValue([
      { id: "cm1", category: "CM", fullName: "CM One", shiftAssignments: [1, 2].map(d => shiftAssignment(d, "N", "night")) },
      { id: "cm2", category: "CM", fullName: "CM Two", shiftAssignments: [] },
    ]);

    const result = await getCoverageAnalysis("station-1", "2026-09");
    expect(result.generated).toBe(true);
    const cmNight = result.rows.find(r => r.category === "CM" && r.shift === "N");
    expect(cmNight.floor).toBe(2);
    expect(cmNight.max).toBe(1); // never actually reaches 2
    expect(cmNight.gapDaysCount).toBeGreaterThan(0);
    expect(cmNight.suggestion).toMatch(/Structural shortage/);
    expect(cmNight.suggestion).toMatch(/CM/);
  });

  it("does not flag a row with no gap days, and skips disabled categories/shifts entirely", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1", isPublished: true });
    // B1 fully covers M/A/N every day for the whole month.
    const nDays = 30;
    const codes = ["M", "A", "N"];
    rosterRepo.getRosterGrid.mockResolvedValue(
      codes.map((code, i) => ({
        id: `b1_${i}`, category: "B1", fullName: `B1 ${i}`,
        shiftAssignments: Array.from({ length: nDays }, (_, d) => shiftAssignment(d + 1, code, code === "N" ? "night" : "duty")),
      })),
    );

    const result = await getCoverageAnalysis("station-1", "2026-09");
    const b1Rows = result.rows.filter(r => r.category === "B1");
    expect(b1Rows).toHaveLength(3); // M, A, N all enabled
    b1Rows.forEach(r => {
      expect(r.min).toBe(1);
      expect(r.gapDaysCount).toBe(0);
      expect(r.suggestion).toBeNull();
    });
    // No B2/CM/NCS staff at all, but disabled combos (B2 M/A, CM M/A, NCS all) never appear as rows.
    expect(result.rows.some(r => r.category === "B2" && (r.shift === "M" || r.shift === "A"))).toBe(false);
    expect(result.rows.some(r => r.category === "NCS")).toBe(false);
  });

  it("surfaces a full-month-leave staff member as a headcount-reducing note", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1", isPublished: false });
    rosterRepo.getRosterGrid.mockResolvedValue([
      { id: "b1_1", category: "B1", fullName: "Active One", shiftAssignments: [] },
      { id: "b1_2", category: "B1", fullName: "On Leave Person", shiftAssignments: [] },
    ]);
    leaveRepo.approvedLeaveForStaffInRange.mockResolvedValue([
      { userId: "b1_2", fromDate: new Date(Date.UTC(2026, 8, 1)), toDate: new Date(Date.UTC(2026, 8, 30)) },
    ]);

    const result = await getCoverageAnalysis("station-1", "2026-09");
    expect(result.headcountByCategory.B1.total).toBe(2);
    expect(result.headcountByCategory.B1.activeEffective).toBe(1);
    expect(result.headcountByCategory.B1.fullMonthLeave).toEqual(["On Leave Person"]);
    expect(result.notes.some(n => n.includes("On Leave Person") && n.includes("effective B1 headcount this month is 1 of 2"))).toBe(true);
  });

  it("classifies a custom shift code by its real shiftDef.type, not just the literal letter", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1", isPublished: false });
    rosterRepo.getRosterGrid.mockResolvedValue([
      { id: "b1_1", category: "B1", fullName: "Custom Coded", shiftAssignments: [1].map(d => shiftAssignment(d, "N2", "night")) },
    ]);
    const result = await getCoverageAnalysis("station-1", "2026-09");
    const b1Night = result.rows.find(r => r.category === "B1" && r.shift === "N");
    // Day 1 should count this N2-coded assignment toward Night coverage.
    expect(b1Night.gapDays.find(g => g.day === 1)).toBeUndefined();
  });

  it("credits a plain B1 staff member's shift toward CM coverage via the license hierarchy, with no secondaryCategories flag at all", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1", isPublished: false });
    rosterRepo.getRosterGrid.mockResolvedValue([
      { id: "b1_1", category: "B1", fullName: "Plain B1", shiftAssignments: [1].map(d => shiftAssignment(d, "M", "duty")) },
    ]);
    workloadConfigService.listMandatoryCoverageRules.mockResolvedValue([
      ...DEFAULT_RULES, { category: "CM", shift: "M", enabled: true, minCount: 1 },
    ]);
    const result = await getCoverageAnalysis("station-1", "2026-09");
    const cmMorning = result.rows.find(r => r.category === "CM" && r.shift === "M");
    expect(cmMorning.gapDays.find(g => g.day === 1)).toBeUndefined();
    // Still a 0-headcount CM category by primary-category count — the
    // hierarchy credits the SHIFT, not the headcount.
    expect(result.headcountByCategory.CM.total).toBe(0);
  });

  it("credits a dual-qualified staff member's shift toward their secondary category too, without inflating that category's active headcount", async () => {
    // Reproduces the real reported gap: a B1 Station I/C, also CM-certified,
    // manually scheduled onto Morning to cover a CM shortfall — the shift
    // must close CM's gap, but "active CM headcount" stays based on
    // primary-category CM staff only (otherwise the structural-shortage
    // math would overstate true CM capacity).
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1", isPublished: false });
    rosterRepo.getRosterGrid.mockResolvedValue([
      {
        id: "ic1", category: "B1", secondaryCategories: ["CM"], fullName: "Station I/C",
        shiftAssignments: [1].map(d => shiftAssignment(d, "M", "duty")),
      },
    ]);
    workloadConfigService.listMandatoryCoverageRules.mockResolvedValue([
      ...DEFAULT_RULES, { category: "CM", shift: "M", enabled: true, minCount: 1 },
    ]);
    const result = await getCoverageAnalysis("station-1", "2026-09");
    const cmMorning = result.rows.find(r => r.category === "CM" && r.shift === "M");
    expect(cmMorning.gapDays.find(g => g.day === 1)).toBeUndefined(); // CM Morning floor of 1 is met by the dual-qualified B1
    // The B1 Morning floor is ALSO still satisfied by the same person — one
    // dual-qualified person genuinely covers both at once.
    const b1Morning = result.rows.find(r => r.category === "B1" && r.shift === "M");
    expect(b1Morning.gapDays.find(g => g.day === 1)).toBeUndefined();
    // "Active CM" headcount is still 0 — this person's PRIMARY category is
    // B1, so CM's own headcount/structural-shortage math isn't inflated by
    // a secondary qualification.
    expect(result.headcountByCategory.CM.total).toBe(0);
    expect(result.headcountByCategory.CM.activeEffective).toBe(0);
  });
});
