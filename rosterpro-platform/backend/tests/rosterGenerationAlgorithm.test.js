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

describe("buildRosterAssignments — full rest-gap rule set (ported from reference-ui)", () => {
  function allPairs(codes) {
    const pairs = [];
    for (let i = 1; i < codes.length; i++) pairs.push([codes[i - 1], codes[i]]);
    return pairs;
  }

  it("never schedules Morning immediately after Afternoon, or Afternoon immediately after Night, under coverage pressure", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const result = buildRosterAssignments({ staff, nDays: 12, leaveByUserDay: {}, blockedUserIds: [] });
    const codes = result.assignments.map(a => a.code);
    for (const [prev, cur] of allPairs(codes)) {
      expect(prev === "A" && cur === "M").toBe(false);
      expect(prev === "N" && cur === "A").toBe(false);
      expect(prev === "N" && cur === "M").toBe(false);
    }
  });

  it("gives two OFF days after two consecutive Night shifts before assigning anything else", () => {
    // Enough B1 staff that the rotation itself, undisturbed by coverage
    // filling, is the thing under test here.
    const staff = [{ id: "b1_0", category: "B1" }];
    const result = buildRosterAssignments({ staff, nDays: 16, leaveByUserDay: {}, blockedUserIds: [] });
    const codes = result.assignments.map(a => a.code);
    for (let i = 2; i < codes.length; i++) {
      if (codes[i - 2] === "N" && codes[i - 1] === "N") {
        expect(codes[i]).toBe("O");
      }
    }
  });

  it("never lets coverage-filling place a Night shift immediately before an already-fixed Morning, even with a single tightly-staffed candidate", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const result = buildRosterAssignments({ staff, nDays: 9, leaveByUserDay: {}, blockedUserIds: [] });
    const codes = result.assignments.map(a => a.code);
    for (const [prev, cur] of allPairs(codes)) {
      expect(prev === "N" && cur === "M").toBe(false);
    }
    // The gap this creates must be honestly reported, not silently dropped.
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("never lets coverage-filling overwrite either mandatory OFF day after two consecutive nights, with any shift", () => {
    // Reproduces a real bug found via live testing: with only 2 B1 staff
    // covering B1 duty on every M/A/N shift, the coverage-fill pass was
    // overwriting the SECOND mandatory rest day (not just the first) with
    // an Afternoon shift, because the guard only protected against a Night
    // fill, not an Afternoon or Morning one.
    const staff = [{ id: "b1_0", category: "B1" }, { id: "b1_1", category: "B1" }];
    const result = buildRosterAssignments({ staff, nDays: 16, leaveByUserDay: {}, blockedUserIds: [] });
    for (const s of staff) {
      const codes = result.assignments.filter(a => a.userId === s.id).sort((a, b) => a.day - b.day).map(a => a.code);
      for (let i = 2; i < codes.length; i++) {
        if (codes[i - 2] === "N" && codes[i - 1] === "N") {
          expect(codes[i]).toBe("O");
        }
      }
    }
  });

  it("continues the rest-gap look-back across the month boundary using tailByUser instead of assuming everyone was OFF", () => {
    const staff = [{ id: "b1_0", category: "B1" }, { id: "b2_0", category: "B2" }];
    const tailByUser = { b1_0: ["N", "N", "O"] }; // finished last month on two Nights
    const result = buildRosterAssignments({ staff, nDays: 5, leaveByUserDay: {}, blockedUserIds: [], tailByUser });
    const day1 = result.assignments.find(a => a.userId === "b1_0" && a.day === 1).code;
    // Day 1's rotation slot for this staff member is Morning (offset 0) —
    // immediately after a Night tail, that would be illegal, so it must be
    // suppressed to OFF rather than defaulting to a fresh-start Morning.
    expect(day1).not.toBe("M");
  });
});

describe("buildRosterAssignments — pattern-based mode (Staff Allocation tab)", () => {
  it("uses the assigned pattern's cycle + offset instead of the default 8-day rotation", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const patternByUser = { b1_0: { codes: ["G", "G", "O"], offset: 0 } }; // 3-day General cycle
    const result = buildRosterAssignments({ staff, nDays: 6, leaveByUserDay: {}, blockedUserIds: [], patternByUser });
    const codes = result.assignments.map(a => a.code);
    // The pattern sets the baseline (G,G,O,G,G,O); the coverage pass still
    // runs on top exactly as it does for the no-pattern path, and with only
    // one B1 staff member it correctly reclaims the pattern's OFF days
    // (day 3 and 6, the only days this lone candidate is idle) to satisfy
    // the "every shift needs >=1 B1" minimum.
    expect(codes).toEqual(["G", "G", "M", "G", "G", "M"]);
  });

  it("still enforces the N-then-M rest-gap rule on a pattern using custom shift codes, via shiftDefsByCode type lookup", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    // A pattern of two custom Night-type shifts back to back into a custom Morning code.
    const patternByUser = { b1_0: { codes: ["N2", "N2", "M1"], offset: 0 } };
    const shiftDefsByCode = { N2: "night", M1: "duty" };
    const result = buildRosterAssignments({ staff, nDays: 3, leaveByUserDay: {}, blockedUserIds: [], patternByUser, shiftDefsByCode });
    const codes = result.assignments.map(a => a.code);
    expect(codes[0]).toBe("N2");
    expect(codes[1]).toBe("N2");
    expect(codes[2]).toBe("O"); // M1 immediately after N2 must be suppressed, same rule as the default M-after-N
  });

  it("leaves an unpatterned staff member (no entry in patternByUser) on the default rotation even when other staff have patterns", () => {
    const staff = [{ id: "patterned", category: "B1" }, { id: "unpatterned", category: "B1" }];
    const patternByUser = { patterned: { codes: ["G"], offset: 0 } };
    const result = buildRosterAssignments({ staff, nDays: 4, leaveByUserDay: {}, blockedUserIds: [], patternByUser });
    const patternedCodes = result.assignments.filter(a => a.userId === "patterned").map(a => a.code);
    const unpatternedCodes = result.assignments.filter(a => a.userId === "unpatterned").map(a => a.code);
    expect(patternedCodes.every(c => c === "G")).toBe(true);
    // idx=1 -> offset 2 -> ROTATION[(day-1+2)%8] for days 1-4 = A,A,N,N; the
    // pattern-holder is never idle ('G' every day) so there's no candidate
    // for the coverage pass to pull onto an uncovered shift, and this
    // sequence has no OFF day of its own to reclaim either.
    expect(unpatternedCodes).toEqual(["A", "A", "N", "N"]);
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

describe("buildRosterAssignments — LMPM pattern lock (verification case 4)", () => {
  it("never assigns a shift on a locked pattern-holder's OFF day, even under coverage pressure that would otherwise reclaim it", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const patternByUser = { b1_0: { codes: ["G", "G", "O"], offset: 0 } };

    // Without a lock, the earlier "pattern-based mode" test proves this exact
    // setup gets day 3 and day 6 reclaimed as "M" by the coverage pass.
    const withoutLock = buildRosterAssignments({ staff, nDays: 6, leaveByUserDay: {}, blockedUserIds: [], patternByUser });
    expect(withoutLock.assignments.map(a => a.code)).toEqual(["G", "G", "M", "G", "G", "M"]);

    const withLock = buildRosterAssignments({
      staff, nDays: 6, leaveByUserDay: {}, blockedUserIds: [], patternByUser, lmpmLockedUserIds: ["b1_0"],
    });
    const codes = withLock.assignments.map(a => a.code);
    expect(codes).toEqual(["G", "G", "O", "G", "G", "O"]); // day 3 and 6 stay OFF — never reclaimed

    // The coverage gap this leaves behind must be honestly reported, not silently absorbed.
    expect(withLock.violations.some(v => v.day === 3)).toBe(true);
    expect(withLock.violations.some(v => v.day === 6)).toBe(true);
  });

  it("still allows an UNLOCKED staff member on the same pattern to be pulled onto coverage as before", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const patternByUser = { b1_0: { codes: ["G", "G", "O"], offset: 0 } };
    const result = buildRosterAssignments({
      staff, nDays: 6, leaveByUserDay: {}, blockedUserIds: [], patternByUser, lmpmLockedUserIds: [],
    });
    expect(result.assignments.map(a => a.code)).toEqual(["G", "G", "M", "G", "G", "M"]);
  });
});

describe("buildRosterAssignments — proactive night_only / no_night rule enforcement", () => {
  it("never assigns a Night shift to a staff member covered by an enabled no_night rule, in either the base rotation or coverage-fill", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const nightRestrictionRules = [
      { name: "No Night - u1", type: "hard", enabled: true, conditionType: "no_night", appliesToType: "staff", appliesToValue: "b1_0" },
    ];
    const result = buildRosterAssignments({ staff, nDays: 8, leaveByUserDay: {}, blockedUserIds: [], nightRestrictionRules });
    expect(result.assignments.every(a => a.code !== "N")).toBe(true);
  });

  it("never assigns a non-Night duty shift to a staff member covered by an enabled night_only rule", () => {
    const staff = [{ id: "b1_0", category: "B1" }, { id: "b1_1", category: "B1" }];
    const nightRestrictionRules = [
      { name: "Night Only - u1", type: "hard", enabled: true, conditionType: "night_only", appliesToType: "staff", appliesToValue: "b1_0" },
    ];
    const result = buildRosterAssignments({ staff, nDays: 8, leaveByUserDay: {}, blockedUserIds: [], nightRestrictionRules });
    const codesU1 = result.assignments.filter(a => a.userId === "b1_0").map(a => a.code);
    expect(codesU1.every(c => c === "N" || c === "O")).toBe(true);
  });

  it("a disabled rule never restricts anything", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const nightRestrictionRules = [
      { name: "No Night - u1", type: "hard", enabled: false, conditionType: "no_night", appliesToType: "staff", appliesToValue: "b1_0" },
    ];
    const result = buildRosterAssignments({ staff, nDays: 8, leaveByUserDay: {}, blockedUserIds: [], nightRestrictionRules });
    expect(result.assignments.some(a => a.code === "N")).toBe(true);
  });
});

describe("buildRosterAssignments — Mandatory vs Advisory two-tier coverage config", () => {
  it("a disabled mandatory category/shift is never force-filled, matching the configured grid instead of the old hardcoded default", () => {
    const staff = Array.from({ length: 3 }, (_, i) => ({ id: `cm${i}`, category: "CM" }));
    const mandatoryCoverageConfig = { CM: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } } };
    const result = buildRosterAssignments({ staff, nDays: 5, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig });
    expect(result.violations).toHaveLength(0); // nothing mandatory configured -> nothing to violate
  });

  it("raising the mandatory minimum above 1 produces at least as much coverage as the default min:1 config", () => {
    const staff = Array.from({ length: 4 }, (_, i) => ({ id: `b1${i}`, category: "B1" }));
    const base = buildRosterAssignments({ staff, nDays: 10, leaveByUserDay: {}, blockedUserIds: [] });
    const mandatoryCoverageConfig = { B1: { M: { enabled: true, min: 2 }, A: { enabled: true, min: 2 }, N: { enabled: true, min: 2 } } };
    const boosted = buildRosterAssignments({ staff, nDays: 10, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig });
    const dutyCount = (result) => result.assignments.filter(a => ["M", "A", "N"].includes(a.code)).length;
    expect(dutyCount(boosted)).toBeGreaterThanOrEqual(dutyCount(base));
  });

  it("advisory demand tops up coverage beyond the mandatory minimum, non-critically", () => {
    const staff = Array.from({ length: 6 }, (_, i) => ({ id: `b1${i}`, category: "B1" }));
    const mandatoryCoverageConfig = { B1: { M: { enabled: true, min: 1 }, A: { enabled: true, min: 1 }, N: { enabled: true, min: 1 } } };
    const advisoryDemand = { 1: { M: { B1: 3 } } };
    const result = buildRosterAssignments({
      staff, nDays: 3, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig, advisoryDemand,
    });
    const day1M = result.assignments.filter(a => a.day === 1 && a.code === "M").length;
    expect(day1M).toBeGreaterThanOrEqual(3);
    expect(result.violations).toHaveLength(0); // an advisory shortfall never counts as a critical violation
  });
});
