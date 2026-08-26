const { buildRosterAssignments } = require("../src/utils/rosterGenerationAlgorithm");

function makeStaff(n, category) {
  return Array.from({ length: n }, (_, i) => ({ id: `${category}${i}`, category }));
}

describe("buildRosterAssignments — coverage", () => {
  it("achieves zero coverage violations with a realistically-staffed pool", () => {
    // Roughly the ratio a real ~30-person line-maintenance station runs —
    // enough B1/B2 slack that the rotation's natural gaps always have an
    // idle person of the right category to patch them.
    const staff = [...makeStaff(8, "B1"), ...makeStaff(6, "B2"), ...makeStaff(10, "CM"), ...makeStaff(8, "NCS")];
    const result = buildRosterAssignments({ staff, nDays: 30, leaveByUserDay: {}, blockedUserIds: [] });

    expect(result.violations).toHaveLength(0);

    const byDay = {};
    for (const a of result.assignments) { (byDay[a.day] ??= {})[a.userId] = a.code; }
    for (let day = 1; day <= 30; day++) {
      for (const shift of ["M", "A", "N"]) {
        expect(staff.some(s => s.category === "B1" && byDay[day][s.id] === shift)).toBe(true);
      }
      expect(staff.some(s => s.category === "B2" && byDay[day][s.id] === "N")).toBe(true);
    }
  });

  it("honestly reports a violation when staffing is too tight to cover every shift, rather than silently leaving a gap", () => {
    // Only 2 B1 for 3 daily shifts (M/A/N) across 30 days with no rest days
    // physically cannot be fully covered — this must show up as violations,
    // not a false "success".
    const staff = [...makeStaff(2, "B1"), ...makeStaff(1, "B2")];
    const result = buildRosterAssignments({ staff, nDays: 30, leaveByUserDay: {}, blockedUserIds: [] });
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("reports a violation (never a crash or silent gap) when a category has zero staff at all", () => {
    const staff = [{ id: "cm0", category: "CM" }];
    const result = buildRosterAssignments({ staff, nDays: 3, leaveByUserDay: {}, blockedUserIds: [] });
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations.every(v => v.category === "B1" || v.category === "B2")).toBe(true);
  });
});

describe("buildRosterAssignments — safety rules take priority over coverage convenience", () => {
  it("never schedules a Morning shift immediately after a Night shift, even under coverage pressure", () => {
    // A single B1 staff member means the coverage pass will be repeatedly
    // tempted to reuse them for every gap — this is the adversarial case
    // that actually caught the original bug in this algorithm.
    const staff = [{ id: "b1_0", category: "B1" }];
    const result = buildRosterAssignments({ staff, nDays: 9, leaveByUserDay: {}, blockedUserIds: [] });
    const codes = result.assignments.map(a => a.code);
    for (let i = 1; i < codes.length; i++) {
      expect(codes[i - 1] === "N" && codes[i] === "M").toBe(false);
    }
  });

  it("reports the resulting gap as a violation instead of double-booking a fatigued staff member", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const result = buildRosterAssignments({ staff, nDays: 9, leaveByUserDay: {}, blockedUserIds: [] });
    expect(result.violations.some(v => v.shift === "M")).toBe(true);
  });
});

describe("buildRosterAssignments — blocking and leave", () => {
  it("never schedules a blocked staff member — every day is OFF", () => {
    const staff = [{ id: "s1", category: "B1" }, { id: "s2", category: "B1" }];
    const result = buildRosterAssignments({ staff, nDays: 10, leaveByUserDay: {}, blockedUserIds: ["s1"] });
    const s1Codes = result.assignments.filter(a => a.userId === "s1").map(a => a.code);
    expect(s1Codes.every(c => c === "O")).toBe(true);
  });

  it("shows the leave code on exactly the days a staff member is on approved leave, and nothing else", () => {
    const staff = [...makeStaff(3, "B1"), ...makeStaff(2, "B2")];
    const leaveByUserDay = { B10: new Set([5, 6, 7]) };
    const result = buildRosterAssignments({ staff, nDays: 10, leaveByUserDay, blockedUserIds: [] });

    const codeOn = (day) => result.assignments.find(a => a.userId === "B10" && a.day === day).code;
    expect(codeOn(5)).toBe("L");
    expect(codeOn(6)).toBe("L");
    expect(codeOn(7)).toBe("L");
    expect(codeOn(8)).not.toBe("L");
  });
});
