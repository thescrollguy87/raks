const { computeManpowerPlan } = require("../src/utils/manpowerPlanning");

// The exact Workload Input config and resulting numbers from the actual
// RosterPro PWA (RosterProPWA7.zip) screenshots the user attached — this
// test locks the pure calculator to those real, independently-verifiable
// numbers rather than to a hand-derived expectation.
const workloadItems = [
  { section: "transit", label: "Morning Transits", count: 6, b1: 1, b2: 0, cm: 1, ncs: 2 },
  { section: "transit", label: "Afternoon Transits", count: 5, b1: 1, b2: 0, cm: 1, ncs: 2 },
  { section: "transit", label: "Night Transits", count: 3, b1: 1, b2: 1, cm: 1, ncs: 1 },
  { section: "nighthalt", label: "Layover Inspection", count: 3, b1: 1, b2: 0, cm: 1, ncs: 1 },
  { section: "nighthalt", label: "Weekly Inspection (A/W check)", count: 1, b1: 1, b2: 1, cm: 2, ncs: 2 },
  { section: "nighthalt", label: "Service Check", count: 2, b1: 1, b2: 1, cm: 1, ncs: 2 },
  { section: "nighthalt", label: "A-Check", count: 0, b1: 1, b2: 1, cm: 3, ncs: 4 },
  { section: "nighthalt", label: "AOG Recovery", count: 0, b1: 1, b2: 1, cm: 2, ncs: 3 },
  { section: "clash", label: "Peak Morning (07:00-09:00)", count: 2, b1: 1, b2: 0, cm: 0, ncs: 1 },
  { section: "task", label: "Hangar Task / Mod", count: 2, b1: 1, b2: 0, cm: 1, ncs: 2 },
  { section: "task", label: "Tool & Equipment Check", count: 4, b1: 0, b2: 0, cm: 0, ncs: 1 },
];

describe("computeManpowerPlan — matches the real RosterPro PWA screenshot numbers exactly", () => {
  const result = computeManpowerPlan({
    workloadItems,
    daysInMon: 30, // September 2026
    aogBuffer: 2,
    staffByCategory: { B1: 0, B2: 0, CM: 0, NCS: 33, STO: 5 },
    totalStaff: 40,
    blockedCount: 40,
  });

  it("matches the Manpower Requirement cards (Morning 7, Afternoon 10, Night 19)", () => {
    expect(result.target).toEqual({ M: 7, A: 10, N: 19 });
    expect(result.grandNeeded).toBe(36);
  });

  it("matches the Category Requirement table exactly", () => {
    const byCategory = Object.fromEntries(result.categoryRequirement.map(r => [r.category, r]));
    expect(byCategory.B1.needs).toEqual({ M: 2, A: 2, N: 4 });
    expect(byCategory.B2.needs).toEqual({ M: 0, A: 0, N: 3 });
    expect(byCategory.CM.needs).toEqual({ M: 1, A: 2, N: 5 });
    expect(byCategory.NCS.needs).toEqual({ M: 3, A: 5, N: 6 });
    expect(byCategory.NCS.available).toBe(33);
    expect(byCategory.NCS.status).toBe("OK");
    expect(byCategory.B1.status).toBe("SHORT"); // available 0 < need 4
  });

  it("matches the shortfall banner (Peak daily need 36, Available 0, Shortfall of 36)", () => {
    expect(result.effectiveStaff).toBe(0);
    expect(result.sufficient).toBe(false);
    expect(result.shortfall).toBe(36);
  });
});

describe("computeManpowerPlan — edge cases", () => {
  it("applies the hard minimum (>=1 B1 every shift, >=1 B2 at night) even with zero workload configured", () => {
    const result = computeManpowerPlan({ workloadItems: [], daysInMon: 30, aogBuffer: 0, staffByCategory: {}, totalStaff: 0, blockedCount: 0 });
    expect(result.peak.M.b1).toBe(1);
    expect(result.peak.A.b1).toBe(1);
    expect(result.peak.N.b1).toBe(1);
    expect(result.peak.N.b2).toBe(1);
  });

  it("reports sufficient coverage when effective staff meets peak need", () => {
    const result = computeManpowerPlan({
      workloadItems: [], daysInMon: 30, aogBuffer: 0,
      staffByCategory: { B1: 5 }, totalStaff: 20, blockedCount: 0,
    });
    expect(result.sufficient).toBe(true);
    expect(result.shortfall).toBe(0);
  });

  it("only counts a transit row's manpower toward Night once a 3rd+ row is added — the exact reference-ui array-position quirk, preserved not fixed", () => {
    const items = [
      { section: "transit", label: "Row1", count: 1, b1: 1, b2: 0, cm: 0, ncs: 0 },
      { section: "transit", label: "Row2", count: 1, b1: 1, b2: 0, cm: 0, ncs: 0 },
      { section: "transit", label: "Row3", count: 1, b1: 1, b2: 0, cm: 0, ncs: 0 },
      { section: "transit", label: "Row4", count: 1, b1: 1, b2: 0, cm: 0, ncs: 0 },
    ];
    const result = computeManpowerPlan({ workloadItems: items, daysInMon: 30, aogBuffer: 0, staffByCategory: {}, totalStaff: 0, blockedCount: 0 });
    // Row1 -> Morning, Row2 -> Afternoon, Row3 AND Row4 -> Night (both land on 'N').
    expect(result.peak.N.b1).toBe(2);
  });
});
