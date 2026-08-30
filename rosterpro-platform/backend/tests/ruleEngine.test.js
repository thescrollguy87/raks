const {
  resolveRuleStaffScope, ruleAppliesToStaff, checkHardRuleCompliance,
  computeHoursBalanceScore, computeNightBalanceScore, cvToScore,
} = require("../src/utils/ruleEngine");

const SHIFT_DEFS = {
  M: { type: "duty", start: "06:30", end: "14:00" },
  A: { type: "duty", start: "13:30", end: "21:30" },
  N: { type: "night", start: "21:00", end: "07:00" },
  O: { type: "off" },
};

describe("resolveRuleStaffScope / ruleAppliesToStaff — rules genuinely filter, never silently apply to everyone", () => {
  const staff = [
    { id: "u1", category: "B1" }, { id: "u2", category: "B2" }, { id: "u3", category: "B1" },
  ];

  it("'all' scope includes everyone", () => {
    const rule = { appliesToType: "all" };
    expect(resolveRuleStaffScope(rule, staff)).toHaveLength(3);
  });

  it("'category' scope only includes that category", () => {
    const rule = { appliesToType: "category", appliesToValue: "B1" };
    const scoped = resolveRuleStaffScope(rule, staff);
    expect(scoped.map(s => s.id)).toEqual(["u1", "u3"]);
    expect(ruleAppliesToStaff(rule, staff[1])).toBe(false); // u2 is B2
    expect(ruleAppliesToStaff(rule, staff[0])).toBe(true);
  });

  it("'group' scope only includes actual group members, empty if the group is missing", () => {
    const rule = { appliesToType: "group", appliesToValue: "G1" };
    const groups = { G1: ["u2"] };
    expect(resolveRuleStaffScope(rule, staff, groups).map(s => s.id)).toEqual(["u2"]);
    expect(resolveRuleStaffScope({ appliesToType: "group", appliesToValue: "MISSING" }, staff, groups)).toEqual([]);
  });

  it("'staff' scope only includes that one individual", () => {
    const rule = { appliesToType: "staff", appliesToValue: "u3" };
    expect(resolveRuleStaffScope(rule, staff).map(s => s.id)).toEqual(["u3"]);
  });
});

describe("checkHardRuleCompliance — dispatches to the correct checker and respects scope", () => {
  it("max_consecutive_nights only flags staff the rule actually applies to", () => {
    const staff = [
      { id: "u1", category: "B1", shifts: ["N", "N", "N", "N"] }, // 4 consecutive nights
      { id: "u2", category: "B2", shifts: ["N", "N", "N", "N"] }, // same violation, but different category
    ];
    const rules = [{ name: "Max 2 Nights", type: "hard", enabled: true, conditionType: "max_consecutive_nights", limitValue: 2, appliesToType: "category", appliesToValue: "B1" }];
    const violations = checkHardRuleCompliance(rules, staff, 4, SHIFT_DEFS);
    expect(violations.every(v => v.staff === "u1")).toBe(true);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("rest_after_night flags Morning immediately after Night", () => {
    const staff = [{ id: "u1", category: "B1", shifts: ["N", "M"] }];
    const rules = [{ name: "Rest After Night", type: "hard", enabled: true, conditionType: "rest_after_night", appliesToType: "all" }];
    const violations = checkHardRuleCompliance(rules, staff, 2, SHIFT_DEFS);
    expect(violations).toHaveLength(1);
    expect(violations[0].day).toBe(2);
  });

  it("night_only flags any non-Night duty shift", () => {
    const staff = [{ id: "u1", category: "B1", shifts: ["M", "N"] }];
    const rules = [{ name: "Night Only", type: "hard", enabled: true, conditionType: "night_only", appliesToType: "staff", appliesToValue: "u1" }];
    const violations = checkHardRuleCompliance(rules, staff, 2, SHIFT_DEFS);
    expect(violations).toHaveLength(1);
    expect(violations[0].day).toBe(1);
  });

  it("no_night flags any Night shift", () => {
    const staff = [{ id: "u1", category: "B1", shifts: ["M", "N"] }];
    const rules = [{ name: "No Night", type: "hard", enabled: true, conditionType: "no_night", appliesToType: "all" }];
    const violations = checkHardRuleCompliance(rules, staff, 2, SHIFT_DEFS);
    expect(violations).toHaveLength(1);
    expect(violations[0].day).toBe(2);
  });

  it("disabled rules never produce violations", () => {
    const staff = [{ id: "u1", category: "B1", shifts: ["N", "N", "N", "N"] }];
    const rules = [{ name: "Max 2 Nights", type: "hard", enabled: false, conditionType: "max_consecutive_nights", limitValue: 2, appliesToType: "all" }];
    expect(checkHardRuleCompliance(rules, staff, 4, SHIFT_DEFS)).toHaveLength(0);
  });
});

describe("cvToScore + balance scoring", () => {
  it("scores 100 when everyone has identical hours", () => {
    expect(cvToScore(0)).toBe(100);
  });
  it("scores lower as variation increases", () => {
    expect(cvToScore(0.5)).toBe(0);
    expect(cvToScore(0.25)).toBe(50);
  });

  it("computeHoursBalanceScore returns null overall for a category with under 2 people", () => {
    const staff = [{ id: "u1", category: "B1", shifts: ["M"] }];
    const result = computeHoursBalanceScore(1, staff, SHIFT_DEFS);
    expect(result.overall).toBeNull();
  });

  it("computeNightBalanceScore excludes pattern-locked staff from the comparison", () => {
    const staff = [
      { id: "u1", category: "B1", shifts: ["N", "N", "N", "N"] }, // pattern-locked, night-heavy by design: 4 nights
      { id: "u2", category: "B1", shifts: ["N", "M", "M", "M"] }, // 1 night
      { id: "u3", category: "B1", shifts: ["N", "M", "M", "M"] }, // 1 night — same as u2
    ];
    const isLocked = s => s.id === "u1";
    const result = computeNightBalanceScore(4, staff, true, isLocked, SHIFT_DEFS);
    // Only u2 and u3 compared (both 1 night, identical) -> perfectly balanced among
    // the eligible ones; u1's 4 nights (which would badly skew the comparison) is
    // excluded entirely because it's dictated by their locked pattern, not a fairness gap.
    const b1 = result.catScores.find(c => c.cat === "B1");
    expect(b1.staffCount).toBe(2);
    expect(b1.score).toBe(100);
  });

  it("without pattern-lock exclusion, the same locked staff member would badly skew the score", () => {
    const staff = [
      { id: "u1", category: "B1", shifts: ["N", "N", "N", "N"] },
      { id: "u2", category: "B1", shifts: ["N", "M", "M", "M"] },
      { id: "u3", category: "B1", shifts: ["N", "M", "M", "M"] },
    ];
    const result = computeNightBalanceScore(4, staff, false, () => false, SHIFT_DEFS);
    const b1 = result.catScores.find(c => c.cat === "B1");
    expect(b1.staffCount).toBe(3);
    expect(b1.score).toBeLessThan(100); // u1's 4 nights vs u2/u3's 1 night each is genuinely unbalanced
  });
});
