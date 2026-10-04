const { buildRosterAssignments, buildCategoryCycle, ROTATION } = require("../src/utils/rosterGenerationAlgorithm");

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

  it("resyncs the default ROTATION's actual phase from a real previous-month tail, not just the day-anchor formula — a staff member who finished a 2-day OFF block last month continues straight into duty on day 1, not another OFF day", () => {
    // Reproduces a real dispatcher-reported gap: the pure day-anchor formula
    // (absoluteDayAnchor, with nothing passed here so it's 0) would put
    // idx=0 at ROTATION[(0+0+0)%8]="M" for day 1 regardless of tailByUser —
    // but a staff member's REAL last 2 real days were "O","O" (the tail end
    // of their own OFF block), i.e. ROTATION index 7, so day 1 should
    // continue the SAME cycle at index 0 ("M") in this particular case. Use
    // a tail that actually disagrees with the day-anchor formula to prove
    // the resync, not the anchor, is driving it: finished on "N","N" (ROTATION
    // index 5), so day 1 must continue at index 6 = "O", not the day-anchor
    // formula's "M".
    const staff = [{ id: "b1_0", category: "B1" }];
    const tailByUser = { b1_0: ["N", "N", "O"] };
    const noMandatory = { B1: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } } };
    const result = buildRosterAssignments({ staff, nDays: 3, leaveByUserDay: {}, blockedUserIds: [], tailByUser, mandatoryCoverageConfig: noMandatory });
    const codes = result.assignments.filter(a => a.userId === "b1_0").sort((a, b) => a.day - b.day).map(a => a.code);
    // Continuing ROTATION = [M,M,A,A,N,N,O,O] from the index right after the
    // matched "N","N" (index 5) gives O (idx6), O (idx7), M (idx0) — the
    // staff member's SECOND rest day, then straight back into duty.
    expect(codes).toEqual(["O", "O", "M"]);
  });

  it("resyncs a named Staff Allocation pattern's phase (e.g. NCS 2-Night/2-Off) from the real previous-month tail", () => {
    // The exact NCS scenario reported: three staff finished their 2 OFF days
    // on the last day of the previous month, so day 1 of the new month
    // should resume the pattern on Night — not restart with another OFF day
    // the way the pure day-anchor/offset formula alone would if the pattern
    // was assigned (or last edited) at a different phase.
    const staff = [{ id: "ncs0", category: "NCS" }];
    const patternByUser = { ncs0: { codes: ["N", "N", "O", "O"], offset: 0 } };
    const tailByUser = { ncs0: ["O", "O", "N"] }; // finished last month: ...N, O, O
    const noMandatory = { NCS: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } } };
    const result = buildRosterAssignments({
      staff, nDays: 4, leaveByUserDay: {}, blockedUserIds: [], patternByUser, tailByUser, mandatoryCoverageConfig: noMandatory,
    });
    const codes = result.assignments.sort((a, b) => a.day - b.day).map(a => a.code);
    expect(codes).toEqual(["N", "N", "O", "O"]);
  });

  it("falls back to the day-anchor formula (no resync) for a staff member with no real previous-month record at all", () => {
    // tailByUser[s.id] is entirely absent (e.g. a brand-new hire with
    // nothing to resync from) — must behave exactly as if continueFromPrevious
    // had never been turned on for this one staff member, not crash or
    // silently pick an arbitrary phase.
    const staff = [{ id: "b1_0", category: "B1" }];
    const tailByUser = {}; // no entry at all for b1_0
    const noMandatory = { B1: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } } };
    const withResyncAttempted = buildRosterAssignments({ staff, nDays: 4, leaveByUserDay: {}, blockedUserIds: [], tailByUser, mandatoryCoverageConfig: noMandatory, absoluteDayAnchor: 0 });
    const withoutContinuity = buildRosterAssignments({ staff, nDays: 4, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig: noMandatory, absoluteDayAnchor: 0 });
    expect(withResyncAttempted.assignments.map(a => a.code)).toEqual(withoutContinuity.assignments.map(a => a.code));
  });

  it("falls back to the day-anchor formula when the real last code doesn't appear in this cycle at all (e.g. a one-off flexi code, or 'L')", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const tailByUser = { b1_0: ["L", "N", "N"] }; // "L" isn't a ROTATION code
    const noMandatory = { B1: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } } };
    const withTail = buildRosterAssignments({ staff, nDays: 4, leaveByUserDay: {}, blockedUserIds: [], tailByUser, mandatoryCoverageConfig: noMandatory, absoluteDayAnchor: 0 });
    const withoutTail = buildRosterAssignments({ staff, nDays: 4, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig: noMandatory, absoluteDayAnchor: 0 });
    // Day 1 isn't suppressed by the "L" tail the way an "N" tail would
    // suppress a Morning start (isLeaveType plays no part in the rest-gap
    // checks), so with no resync possible, this must match the plain
    // day-anchor run exactly.
    expect(withTail.assignments.map(a => a.code)).toEqual(withoutTail.assignments.map(a => a.code));
  });
});

describe("buildRosterAssignments — cross-category qualifications (B1 license hierarchy + secondaryCategories) never auto-move anyone during generation", () => {
  // Confirmed directly with the user: nobody should ever be automatically
  // pulled off their office/admin duty OR their day off to cover a
  // DIFFERENT category's gap — not even a staff member genuinely qualified
  // for it (every B1 for CM, or an explicitly flagged secondary category).
  // That's a deliberate human call (bring in real extra headcount, or
  // manually move someone's day off yourself), never something the
  // generator decides silently. A cross-category gap is left as an
  // honestly-reported violation/advisory gap — Coverage Analysis is where
  // it then gets credited correctly if a human DOES manually place someone
  // there (see rosterAnalysisService.test.js).
  it("never pulls a plain B1 staff member's OFF day to cover a CM-only gap, even with no CM staff at all — reports the gap instead", () => {
    const staff = [{ id: "s0", category: "B1" }]; // no secondaryCategories, just the B1 hierarchy
    const mandatoryCoverageConfig = {
      B1: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
      CM: { M: { enabled: true, min: 1 }, A: { enabled: false }, N: { enabled: false } },
    };
    const result = buildRosterAssignments({ staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig, absoluteDayAnchor: 6 });
    expect(result.assignments[0].code).toBe("O"); // left untouched on their own day off
    expect(result.flexiAssignments).toHaveLength(0);
    expect(result.violations.some(v => v.category === "CM" && v.day === 1 && v.shift === "M")).toBe(true);
  });

  it("never pulls an explicitly secondary-qualified staff member's OFF day either — same report-only behavior", () => {
    const staff = [{ id: "s0", category: "NCS", secondaryCategories: ["CM"] }];
    const mandatoryCoverageConfig = {
      NCS: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } },
      CM: { M: { enabled: true, min: 1 }, A: { enabled: false }, N: { enabled: false } },
    };
    const result = buildRosterAssignments({ staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig, absoluteDayAnchor: 6 });
    expect(result.assignments[0].code).toBe("O");
    expect(result.flexiAssignments).toHaveLength(0);
    expect(result.violations.some(v => v.category === "CM" && v.day === 1 && v.shift === "M")).toBe(true);
  });

  it("never redistributes a dual-qualified staff member's ALREADY-WORKING shift into a different category's gap either — same-day redistribution also stays strictly same-category", () => {
    // Two B1 on Morning (floor 1, so one is a genuine same-category surplus)
    // — CM is short on Afternoon. Before this behavior was locked down, the
    // surplus B1 could have been redistributed into CM's Afternoon gap;
    // now they must stay exactly where the base rotation put them.
    const staff = [{ id: "b1_0", category: "B1" }, { id: "b1_1", category: "B1" }];
    const mandatoryCoverageConfig = {
      B1: { M: { enabled: true, min: 1 }, A: { enabled: false }, N: { enabled: false } },
      CM: { M: { enabled: false }, A: { enabled: true, min: 1 }, N: { enabled: false } },
    };
    const result = buildRosterAssignments({ staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig, absoluteDayAnchor: 0 });
    expect(result.violations.some(v => v.category === "CM" && v.shift === "A")).toBe(true);
    expect(result.flexiAssignments).toHaveLength(0);
  });

  it("does NOT extend the hierarchy the other way — a plain CM staff member is never credited toward B1 coverage", () => {
    const staff = [{ id: "s0", category: "CM" }];
    const mandatoryCoverageConfig = { B1: { M: { enabled: true, min: 1 }, A: { enabled: false }, N: { enabled: false } } };
    const result = buildRosterAssignments({ staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig, absoluteDayAnchor: 0 });
    expect(result.violations.some(v => v.category === "B1")).toBe(true); // genuinely unmet, not silently satisfied by the CM person
  });

  it("still fills a same-category mandatory gap exactly as before — this change only removed the CROSS-category expansion, not the original behavior", () => {
    const staff = [{ id: "cm_0", category: "CM" }];
    const mandatoryCoverageConfig = { CM: { M: { enabled: true, min: 1 }, A: { enabled: false }, N: { enabled: false } } };
    const result = buildRosterAssignments({ staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig, absoluteDayAnchor: 6 });
    expect(result.assignments[0].code).toBe("M"); // own-category flexi pull off their day off still applies
    expect(result.flexiAssignments).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });
});

describe("buildRosterAssignments — pattern-based mode (Staff Allocation tab)", () => {
  it("uses the assigned pattern's cycle + offset instead of the default 8-day rotation", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const patternByUser = { b1_0: { codes: ["G", "G", "O"], offset: 0 } }; // 3-day General cycle
    const result = buildRosterAssignments({ staff, nDays: 6, leaveByUserDay: {}, blockedUserIds: [], patternByUser });
    const codes = result.assignments.map(a => a.code);
    // The pattern sets the baseline (G,G,O,G,G,O). With only one B1 staff
    // member there's no one else to redistribute a shortfall from — but
    // the default Mandatory Minimum Coverage floor (>=1 B1 every shift) is
    // non-negotiable, so the flexi exigency fallback pulls this staff
    // member's own OFF days (3 and 6) to meet it even without the
    // "Patterns + Automatic" override enabled, rather than leaving the
    // floor unmet.
    expect(codes).toEqual(["G", "G", "M", "G", "G", "M"]);
    expect(result.violations.some(v => v.day === 3 && v.shift === "M")).toBe(false);
    expect(result.flexiAssignments.every(f => f.mandatory)).toBe(true);
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

  it("counts a custom shift code toward its family's coverage, not just literal M/A/N", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const patternByUser = { b1_0: { codes: ["M1"], offset: 0 } };
    const shiftDefsByCode = { M1: "duty" };
    const mandatoryCoverageConfig = { B1: { M: { enabled: true, min: 1 }, A: { enabled: false }, N: { enabled: false } } };
    const result = buildRosterAssignments({
      staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], patternByUser, shiftDefsByCode, mandatoryCoverageConfig,
    });
    // Previously the coverage bucket only matched literal "M" — a staff
    // member on the custom code "M1" was invisible to it and the floor
    // would wrongly report unmet even though someone is genuinely there.
    expect(result.violations).toHaveLength(0);
  });

  it("allows a custom-coded staff member to donate as a same-day redistribution surplus", () => {
    const staff = [{ id: "ncs0", category: "NCS" }, { id: "ncs1", category: "NCS" }, { id: "ncs2", category: "NCS" }];
    const patternByUser = {
      ncs0: { codes: ["M1"], offset: 0 }, ncs1: { codes: ["M1"], offset: 0 }, ncs2: { codes: ["M1"], offset: 0 },
    };
    const shiftDefsByCode = { M1: "duty" };
    const mandatoryCoverageConfig = { NCS: { M: { enabled: true, min: 1 }, A: { enabled: true, min: 1 }, N: { enabled: false } } };
    const result = buildRosterAssignments({
      staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], patternByUser, shiftDefsByCode, mandatoryCoverageConfig,
    });
    const day1 = result.assignments.filter(a => a.day === 1);
    // All 3 started on the custom "M1" code. M's floor is 1, so 2 are
    // genuine surplus — one of them must be usable to cover Afternoon's
    // floor of 1, exactly as if they'd started on a plain "M".
    expect(day1.filter(a => a.code === "M1").length).toBe(2);
    expect(day1.filter(a => a.code === "A").length).toBe(1);
    expect(result.violations).toHaveLength(0);
  });

  it("leaves an unpatterned staff member (no entry in patternByUser) on the default rotation even when other staff have patterns", () => {
    const staff = [{ id: "patterned", category: "B1" }, { id: "unpatterned", category: "B1" }];
    const patternByUser = { patterned: { codes: ["G"], offset: 0 } };
    const result = buildRosterAssignments({ staff, nDays: 4, leaveByUserDay: {}, blockedUserIds: [], patternByUser });
    const patternedCodes = result.assignments.filter(a => a.userId === "patterned").map(a => a.code);
    const unpatternedCodes = result.assignments.filter(a => a.userId === "unpatterned").map(a => a.code);
    expect(patternedCodes.every(c => c === "G")).toBe(true);
    // The per-category offset counter only counts staff who actually land
    // on the shared fallback cycle — a pattern-holder never touches it, so
    // doesn't consume a phase slot in it either. "unpatterned" is the
    // FIRST (and only) B1 staff member on the fallback cycle, so it gets
    // offset 0 -> ROTATION[(day-1+0)%8] for days 1-4 = M,M,A,A. (The old
    // idx*2 counted every staff member's position in the whole roster,
    // patterned or not, which gave "unpatterned" offset 2 purely because
    // it happened to sit second in the input array — not a meaningful
    // phase-spread within the group that actually shares this cycle.)
    // The pattern-holder is never idle ('G' every day) so there's no
    // candidate for the coverage pass to pull onto an uncovered shift
    // either way, and this sequence has no OFF day of its own to reclaim.
    expect(unpatternedCodes).toEqual(["M", "M", "A", "A"]);
  });
});

describe("buildRosterAssignments — rotation is a perpetual cycle across month boundaries (absoluteDayAnchor)", () => {
  const noMandatory = { B1: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } } };

  it("the flat 8-day ROTATION continues seamlessly when a later month's anchor picks up where an earlier month left off", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const month1 = buildRosterAssignments({ staff, nDays: 5, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig: noMandatory, absoluteDayAnchor: 0 });
    const month2 = buildRosterAssignments({ staff, nDays: 3, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig: noMandatory, absoluteDayAnchor: 5 });
    const combined = [...month1.assignments.map(a => a.code), ...month2.assignments.map(a => a.code)];
    // One full, uninterrupted 8-day cycle: M,M,A,A,N,N,O,O — NOT restarting
    // at M on month2's day 1 the way indexing purely by day-of-month would.
    expect(combined).toEqual(["M", "M", "A", "A", "N", "N", "O", "O"]);
  });

  it("defaults absoluteDayAnchor to 0 when omitted, so existing callers (and every prior test above) are unaffected", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const withoutAnchor = buildRosterAssignments({ staff, nDays: 4, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig: noMandatory });
    const withZeroAnchor = buildRosterAssignments({ staff, nDays: 4, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig: noMandatory, absoluteDayAnchor: 0 });
    expect(withoutAnchor.assignments.map(a => a.code)).toEqual(withZeroAnchor.assignments.map(a => a.code));
  });

  it("a named Staff Allocation pattern also continues across the boundary via the same anchor", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const patternByUser = { b1_0: { codes: ["G", "G", "O", "G"], offset: 0 } }; // 4-day custom cycle
    const month1 = buildRosterAssignments({ staff, nDays: 3, leaveByUserDay: {}, blockedUserIds: [], patternByUser, mandatoryCoverageConfig: noMandatory, absoluteDayAnchor: 0 });
    const month2 = buildRosterAssignments({ staff, nDays: 2, leaveByUserDay: {}, blockedUserIds: [], patternByUser, mandatoryCoverageConfig: noMandatory, absoluteDayAnchor: 3 });
    const combined = [...month1.assignments.map(a => a.code), ...month2.assignments.map(a => a.code)];
    expect(combined).toEqual(["G", "G", "O", "G", "G"]); // one full 4-day cycle, then one day into the next
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
    const leaveByUserDay = { B10: new Map([[5, "ANNUAL"], [6, "ANNUAL"], [7, "ANNUAL"]]) };
    const result = buildRosterAssignments({ staff, nDays: 10, leaveByUserDay, blockedUserIds: [] });

    const codeOn = (day) => result.assignments.find(a => a.userId === "B10" && a.day === day).code;
    expect(codeOn(5)).toBe("L");
    expect(codeOn(6)).toBe("L");
    expect(codeOn(7)).toBe("L");
    expect(codeOn(8)).not.toBe("L");
  });

  it("resolves Training and Deputation leave to their own shift codes, distinct from ordinary leave", () => {
    const staff = makeStaff(1, "B1");
    const leaveByUserDay = { B10: new Map([[1, "TRAINING"], [2, "DEPUTATION"], [3, "ANNUAL"]]) };
    const result = buildRosterAssignments({ staff, nDays: 3, leaveByUserDay, blockedUserIds: [] });

    const codeOn = (day) => result.assignments.find(a => a.userId === "B10" && a.day === day).code;
    expect(codeOn(1)).toBe("TRG");
    expect(codeOn(2)).toBe("D");
    expect(codeOn(3)).toBe("L");
  });
});

describe("buildRosterAssignments — same-day surplus/deficit redistribution (never touches an OFF day)", () => {
  it("moves a genuine surplus staff member from an over-covered shift to a short-staffed shift, same day", () => {
    const staff = [{ id: "ncs0", category: "NCS" }, { id: "ncs1", category: "NCS" }, { id: "ncs2", category: "NCS" }];
    const patternByUser = {
      ncs0: { codes: ["M"], offset: 0 }, ncs1: { codes: ["M"], offset: 0 }, ncs2: { codes: ["M"], offset: 0 },
    };
    const mandatoryCoverageConfig = { NCS: { M: { enabled: true, min: 1 }, A: { enabled: true, min: 1 }, N: { enabled: false } } };
    const result = buildRosterAssignments({
      staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], patternByUser, mandatoryCoverageConfig,
    });
    const day1 = result.assignments.filter(a => a.day === 1);
    // All 3 started on M (the pattern baseline). M's own floor is 1, so 2
    // are genuine surplus; one of them covers Afternoon's otherwise-unmet
    // floor of 1. Nobody was ever OFF to begin with — this is a pure
    // same-day reassignment, exactly "1 NCS from morning covers afternoon".
    expect(day1.filter(a => a.code === "M").length).toBe(2);
    expect(day1.filter(a => a.code === "A").length).toBe(1);
    expect(result.violations).toHaveLength(0);
  });

  it("never pulls from a shift that's already exactly at its own mandatory floor — no real surplus there", () => {
    const staff = [{ id: "ncs0", category: "NCS" }];
    const patternByUser = { ncs0: { codes: ["M"], offset: 0 } };
    const mandatoryCoverageConfig = { NCS: { M: { enabled: true, min: 1 }, A: { enabled: true, min: 1 }, N: { enabled: false } } };
    const result = buildRosterAssignments({
      staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], patternByUser, mandatoryCoverageConfig,
    });
    const day1 = result.assignments.filter(a => a.day === 1);
    expect(day1.find(a => a.userId === "ncs0").code).toBe("M"); // stays put — M is exactly at its own floor, no surplus to give
    const gap = result.violations.find(v => v.shift === "A" && v.category === "NCS");
    expect(gap).toBeTruthy(); // Afternoon's shortfall is honestly reported instead
    expect(gap.shortfall).toBe(1); // exactly 1 missing, not just "a gap exists"
  });

  it("reports the real missing headcount, not just 1, when a shift is short by more than one person", () => {
    const staff = [{ id: "ncs0", category: "NCS" }];
    const patternByUser = { ncs0: { codes: ["M"], offset: 0 } };
    // Floor of 3 with only 1 person total and nobody to redistribute from —
    // the gap is 2 people short, not 1.
    const mandatoryCoverageConfig = { NCS: { M: { enabled: true, min: 3 }, A: { enabled: false }, N: { enabled: false } } };
    const result = buildRosterAssignments({
      staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], patternByUser, mandatoryCoverageConfig,
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].shortfall).toBe(2);
    expect(result.violations[0].issue).toMatch(/2 NCS short/);
  });

  it("a lone staff member's own OFF day is never touched by same-day REDISTRIBUTION (step 1) regardless of lock state — only the mandatory-floor flexi step can reach it, and only when unlocked", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const patternByUser = { b1_0: { codes: ["G", "G", "O"], offset: 0 } };
    const unlocked = buildRosterAssignments({ staff, nDays: 6, leaveByUserDay: {}, blockedUserIds: [], patternByUser, lmpmLockedUserIds: [] });
    const locked = buildRosterAssignments({ staff, nDays: 6, leaveByUserDay: {}, blockedUserIds: [], patternByUser, lmpmLockedUserIds: ["b1_0"] });
    // Unlocked: no one to redistribute FROM (step 1 never applies with a
    // single staff member), but the default mandatory B1 floor is
    // non-negotiable, so the flexi step (step 2) pulls their own OFF days.
    expect(unlocked.assignments.map(a => a.code)).toEqual(["G", "G", "M", "G", "G", "M"]);
    expect(unlocked.violations.some(v => v.day === 3 && v.shift === "M")).toBe(false);
    // Locked: the flexi step never touches a pattern-locked staff member's
    // OFF day either, so the floor genuinely goes unmet and is reported.
    expect(locked.assignments.map(a => a.code)).toEqual(["G", "G", "O", "G", "G", "O"]);
    expect(locked.violations.some(v => v.day === 3)).toBe(true);
  });

  it("never redistributes a surplus staff member into a shift that would break their OWN already-fixed next day", () => {
    // ncs0 is fixed Morning-then-Afternoon (day 1 -> day 2) — a legal pair
    // on its own. If redistribution moved ncs0 from day 1's Morning onto
    // Night (to cover a Night shortfall), day 2's already-fixed Afternoon
    // would now illegally follow a Night, which nothing else re-validates
    // once day 2 has already been computed. ncs1 (Morning then OFF) has no
    // such conflict and must be picked instead.
    const staff = [{ id: "ncs0", category: "NCS" }, { id: "ncs1", category: "NCS" }];
    const patternByUser = { ncs0: { codes: ["M", "A"], offset: 0 }, ncs1: { codes: ["M", "O"], offset: 0 } };
    const result = buildRosterAssignments({
      staff, nDays: 2, leaveByUserDay: {}, blockedUserIds: [], patternByUser,
      advisoryDemand: { 1: { N: { NCS: 1 } } },
    });
    const day1 = result.assignments.filter(a => a.day === 1);
    const day2 = result.assignments.filter(a => a.day === 2);
    expect(day1.find(a => a.userId === "ncs0").code).toBe("M"); // stays — moving them would break day 2's already-fixed Afternoon
    expect(day1.find(a => a.userId === "ncs1").code).toBe("N"); // the safe donor covers it instead
    expect(day2.find(a => a.userId === "ncs0").code).toBe("A"); // untouched
    expect(day2.find(a => a.userId === "ncs1").code).toBe("O"); // untouched
    expect(result.violations.some(v => v.category === "NCS")).toBe(false);
  });

  it("never redistributes into a Night that would leave only ONE of the two mandatory rest days after it", () => {
    // ncs0's own pattern (A, N, O, M) is perfectly legal as originally
    // computed — day 2's lone Night has nothing adjacent to it, so Step 1
    // never required a second rest day. But if redistribution moves ncs0's
    // day 1 from Afternoon onto Night (to cover a Night shortfall), day 1
    // and day 2 become two Nights in a row — which means BOTH day 3 and
    // day 4 are now required to be OFF. Day 3 already is (coincidentally),
    // but day 4 is already fixed as a working Morning — exactly the
    // "2nd mandatory rest day" that must never go missing. ncs1 (A, N, O,
    // O) has no such conflict and must be picked instead.
    const staff = [{ id: "ncs0", category: "NCS" }, { id: "ncs1", category: "NCS" }];
    const patternByUser = {
      ncs0: { codes: ["A", "N", "O", "M"], offset: 0 },
      ncs1: { codes: ["A", "N", "O", "O"], offset: 0 },
    };
    // Target scoped to day 1 only (like the neighboring test above) so this
    // doesn't also trigger a separate, unrelated redistribution into day
    // 4's own Night requirement — the point here is purely what happens
    // when day 1 is redistributed. Mandatory config disabled entirely
    // since there's no B1/B2 staff in this scenario (the default config
    // would otherwise report unrelated B1/B2 shortfalls).
    const mandatoryCoverageConfig = { B1: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } }, B2: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } } };
    const result = buildRosterAssignments({
      staff, nDays: 4, leaveByUserDay: {}, blockedUserIds: [], patternByUser, mandatoryCoverageConfig,
      advisoryDemand: { 1: { N: { NCS: 1 } } },
    });
    const byDay = d => result.assignments.filter(a => a.day === d);
    expect(byDay(1).find(a => a.userId === "ncs0").code).toBe("A"); // stays — moving them would break day 4's already-fixed Morning as the 2nd rest day
    expect(byDay(1).find(a => a.userId === "ncs1").code).toBe("N"); // the safe donor covers it instead
    expect(byDay(4).find(a => a.userId === "ncs0").code).toBe("M"); // untouched
    expect(result.violations.some(v => v.category === "NCS")).toBe(false);
  });

  it("respects a night-restriction rule on the shift a surplus staff member would move INTO", () => {
    // Both start the day on Afternoon and Night is short-staffed. ncs0 has a
    // hard no_night rule, so moving them onto Night would violate it — the
    // redistribution must skip them and pick ncs1 instead.
    const staff = [{ id: "ncs0", category: "NCS" }, { id: "ncs1", category: "NCS" }];
    const patternByUser = { ncs0: { codes: ["A"], offset: 0 }, ncs1: { codes: ["A"], offset: 0 } };
    const nightRestrictionRules = [
      { enabled: true, type: "hard", conditionType: "no_night", appliesToType: "staff", appliesToValue: "ncs0" },
    ];
    const mandatoryCoverageConfig = { B1: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } } };
    const result = buildRosterAssignments({
      staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], patternByUser, nightRestrictionRules, mandatoryCoverageConfig,
      advisoryDemand: { 1: { N: { NCS: 1 } } },
    });
    const day1 = result.assignments.filter(a => a.day === 1);
    expect(day1.find(a => a.userId === "ncs0").code).toBe("A"); // stays — a no_night rule blocks this move
    expect(day1.find(a => a.userId === "ncs1").code).toBe("N"); // the eligible donor covers it instead
    expect(result.violations.some(v => v.category === "NCS")).toBe(false);
  });
});

describe("buildRosterAssignments — flexi exigency fallback (allowPatternOverrideForCoverage)", () => {
  it("pulls an UNLOCKED staff member's OFF day as a genuine last resort only when redistribution finds nobody, and flags it separately", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const patternByUser = { b1_0: { codes: ["G", "G", "O"], offset: 0 } };
    const result = buildRosterAssignments({
      staff, nDays: 6, leaveByUserDay: {}, blockedUserIds: [], patternByUser, lmpmLockedUserIds: [],
      allowPatternOverrideForCoverage: true,
    });
    expect(result.assignments.map(a => a.code)).toEqual(["G", "G", "M", "G", "G", "M"]);
    expect(result.violations.filter(v => (v.day === 3 || v.day === 6) && v.shift === "M")).toHaveLength(0);
    expect(result.flexiAssignments).toEqual([
      { userId: "b1_0", day: 3, shift: "M", category: "B1", mandatory: true },
      { userId: "b1_0", day: 6, shift: "M", category: "B1", mandatory: true },
    ]);
  });

  it("never pulls a pattern-LOCKED staff member's OFF day even with the exigency fallback enabled", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const patternByUser = { b1_0: { codes: ["G", "G", "O"], offset: 0 } };
    const result = buildRosterAssignments({
      staff, nDays: 6, leaveByUserDay: {}, blockedUserIds: [], patternByUser, lmpmLockedUserIds: ["b1_0"],
      allowPatternOverrideForCoverage: true,
    });
    expect(result.assignments.map(a => a.code)).toEqual(["G", "G", "O", "G", "G", "O"]);
    expect(result.flexiAssignments).toHaveLength(0);
    expect(result.violations.some(v => v.day === 3)).toBe(true);
  });

  it("among off-day candidates, picks the unlocked one over the locked one (advisory shortfall)", () => {
    const staff = [{ id: "locked", category: "B1" }, { id: "free", category: "B1" }];
    const patternByUser = { locked: { codes: ["O"], offset: 0 }, free: { codes: ["O"], offset: 0 } };
    const mandatoryCoverageConfig = { B1: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } } };
    const result = buildRosterAssignments({
      staff, nDays: 2, leaveByUserDay: {}, blockedUserIds: [], patternByUser, lmpmLockedUserIds: ["locked"],
      allowPatternOverrideForCoverage: true, mandatoryCoverageConfig,
      advisoryDemand: { 1: { M: { B1: 1 } } },
    });
    const day1 = result.assignments.filter(a => a.day === 1);
    expect(day1.find(a => a.userId === "free").code).toBe("M");
    expect(day1.find(a => a.userId === "locked").code).toBe("O");
    expect(result.flexiAssignments).toEqual([{ userId: "free", day: 1, shift: "M", category: "B1", mandatory: false }]);
  });

  it("still prefers same-day redistribution over the flexi fallback when both could resolve the gap", () => {
    const staff = [{ id: "surplus", category: "B1" }, { id: "offday", category: "B1" }];
    const patternByUser = { surplus: { codes: ["M"], offset: 0 }, offday: { codes: ["O"], offset: 0 } };
    const mandatoryCoverageConfig = { B1: { M: { enabled: false }, A: { enabled: true, min: 1 }, N: { enabled: false } } };
    const result = buildRosterAssignments({
      staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], patternByUser, mandatoryCoverageConfig,
      allowPatternOverrideForCoverage: true,
    });
    const day1 = result.assignments.filter(a => a.day === 1);
    expect(day1.find(a => a.userId === "surplus").code).toBe("A"); // redistributed, same day
    expect(day1.find(a => a.userId === "offday").code).toBe("O"); // never touched — redistribution already resolved it
    expect(result.flexiAssignments).toHaveLength(0);
  });

  // Confirmed directly with the user: a MANDATORY floor is non-negotiable,
  // so — unlike an ordinary advisory shortfall — it automatically tries the
  // off-day flexi fallback even without "Patterns + Automatic" turned on.
  it("WITHOUT the override flag, a mandatory shortfall still pulls an off-day staff member as a last resort", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const patternByUser = { b1_0: { codes: ["G", "G", "O"], offset: 0 } };
    const result = buildRosterAssignments({
      staff, nDays: 6, leaveByUserDay: {}, blockedUserIds: [], patternByUser, lmpmLockedUserIds: [],
      allowPatternOverrideForCoverage: false,
    });
    expect(result.assignments.map(a => a.code)).toEqual(["G", "G", "M", "G", "G", "M"]);
    expect(result.flexiAssignments).toEqual([
      { userId: "b1_0", day: 3, shift: "M", category: "B1", mandatory: true },
      { userId: "b1_0", day: 6, shift: "M", category: "B1", mandatory: true },
    ]);
    // The Morning floor this flexi fill targeted is resolved; a lone staff
    // member obviously still can't also cover Afternoon/Night/B2 the same
    // day, so those floors remain honestly reported rather than hidden.
    expect(result.violations.filter(v => (v.day === 3 || v.day === 6) && v.shift === "M")).toHaveLength(0);
  });

  it("WITHOUT the override flag, an ADVISORY shortfall still never touches anyone's OFF day", () => {
    const staff = [{ id: "ncs_0", category: "NCS" }];
    const patternByUser = { ncs_0: { codes: ["O"], offset: 0 } };
    const mandatoryCoverageConfig = { NCS: { M: { enabled: false }, A: { enabled: false }, N: { enabled: false } } };
    const result = buildRosterAssignments({
      staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], patternByUser, mandatoryCoverageConfig,
      allowPatternOverrideForCoverage: false,
      advisoryDemand: { 1: { M: { NCS: 1 } } },
    });
    expect(result.assignments[0].code).toBe("O");
    expect(result.flexiAssignments).toHaveLength(0);
    expect(result.advisoryGaps).toHaveLength(1);
  });

  // The same lone-pattern-locked-staff-member scenario as above, but for a
  // mandatory floor: the lock must still win even though mandatory shortfalls
  // now auto-escalate to flexi — "last resort" never overrides the lock.
  it("a pattern-locked staff member's OFF day stays protected even for a mandatory shortfall with the override flag off", () => {
    const staff = [{ id: "b1_0", category: "B1" }];
    const patternByUser = { b1_0: { codes: ["G", "G", "O"], offset: 0 } };
    const result = buildRosterAssignments({
      staff, nDays: 6, leaveByUserDay: {}, blockedUserIds: [], patternByUser, lmpmLockedUserIds: ["b1_0"],
      allowPatternOverrideForCoverage: false,
    });
    expect(result.assignments.map(a => a.code)).toEqual(["G", "G", "O", "G", "G", "O"]);
    expect(result.flexiAssignments).toHaveLength(0);
    expect(result.violations.some(v => v.day === 3)).toBe(true);
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
    // N left unmandated — this test is about Morning's advisory top-up, not
    // Night coverage, and advisoryDemand here is a deliberately sparse
    // (Morning-day-1-only) fixture: buildCategoryCycle now also reads this
    // same advisoryDemand to shape B1's base rotation (see
    // rosterGenerationAlgorithm.js), and a fixture this sparse happens to
    // produce a Night-free base cycle — true to a real month's fully
    // populated advisoryDemand, but not what this fixture represents.
    // Requiring Night coverage here would be testing an artifact of the
    // fixture's sparseness, not the advisory-topup behavior itself.
    const mandatoryCoverageConfig = { B1: { M: { enabled: true, min: 1 }, A: { enabled: true, min: 1 }, N: { enabled: false } } };
    const advisoryDemand = { 1: { M: { B1: 3 } } };
    const result = buildRosterAssignments({
      staff, nDays: 3, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig, advisoryDemand,
    });
    const day1M = result.assignments.filter(a => a.day === 1 && a.code === "M").length;
    expect(day1M).toBeGreaterThanOrEqual(3);
    expect(result.violations).toHaveLength(0); // an advisory shortfall never counts as a critical violation
  });

  // NCS previously had no mandatory tier at all — the fill loop only ever
  // iterated B1/B2/CM (see git history), so with zero flight-schedule-
  // driven advisory demand for a given day/shift, NCS coverage depended
  // entirely on where the base 8-day rotation happened to land, with
  // nothing correcting a coincidental shortfall (the real Oct 1 gap this
  // was reported against). NCS is now in that loop the same as the other
  // three categories.
  it("enforces a mandatory NCS minimum, same as B1/B2/CM", () => {
    const staff = Array.from({ length: 8 }, (_, i) => ({ id: `ncs${i}`, category: "NCS" }));
    const mandatoryCoverageConfig = { NCS: { M: { enabled: true, min: 2 }, A: { enabled: true, min: 2 }, N: { enabled: false } } };
    const result = buildRosterAssignments({ staff, nDays: 5, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig });
    for (let day = 1; day <= 5; day++) {
      const onM = result.assignments.filter(a => a.day === day && a.code === "M").length;
      const onA = result.assignments.filter(a => a.day === day && a.code === "A").length;
      expect(onM).toBeGreaterThanOrEqual(2);
      expect(onA).toBeGreaterThanOrEqual(2);
    }
    expect(result.violations).toHaveLength(0); // enough staff exist to actually meet it
  });

  it("reports an unmet mandatory NCS slot as a critical violation when nobody is eligible", () => {
    const staff = [{ id: "ncs0", category: "NCS" }]; // one person can't cover a min:2 requirement
    const mandatoryCoverageConfig = { NCS: { M: { enabled: true, min: 2 }, A: { enabled: false }, N: { enabled: false } } };
    const result = buildRosterAssignments({ staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], mandatoryCoverageConfig });
    expect(result.violations).toContainEqual(expect.objectContaining({ day: 1, shift: "M", category: "NCS" }));
  });
});

describe("buildRosterAssignments — trainingPendingUserIds (Section 4/4: mandatory training not yet completed)", () => {
  it("excludes a training-pending staff member from the coverage pool — never counted, never a redistribution donor", () => {
    // Two B1 staff; one is training-pending. A floor of 1 per shift should
    // only ever be satisfiable using the QUALIFIED staff member — the
    // training-pending one must never be counted as covering a shift even
    // if their own base schedule happens to land them on one.
    const staff = [{ id: "qualified", category: "B1" }, { id: "pending", category: "B1" }];
    const patternByUser = {
      qualified: { codes: ["O"], offset: 0 }, // off every day — must be pulled via flexi to meet the floor
      pending: { codes: ["M"], offset: 0 }, // working Morning every day, but not qualified
    };
    const mandatoryCoverageConfig = { B1: { M: { enabled: true, min: 1 }, A: { enabled: false }, N: { enabled: false } } };
    const result = buildRosterAssignments({
      staff, nDays: 1, leaveByUserDay: {}, blockedUserIds: [], patternByUser, mandatoryCoverageConfig,
      trainingPendingUserIds: ["pending"],
    });
    const day1 = result.assignments.filter(a => a.day === 1);
    // The training-pending staff member's own M assignment is untouched —
    // they still show as working (e.g. admin duty per their own pattern) —
    // but the qualified staff member was pulled in via flexi because the
    // training-pending one was never counted toward the M floor.
    expect(day1.find(a => a.userId === "pending").code).toBe("M");
    expect(day1.find(a => a.userId === "qualified").code).toBe("M");
    expect(result.flexiAssignments).toEqual([{ userId: "qualified", day: 1, shift: "M", category: "B1", mandatory: true }]);
  });

  it("defaults an UNPATTERNED training-pending staff member to OFF instead of the flat rotation's real M/A/N codes", () => {
    const staff = [{ id: "pending", category: "B1" }];
    const result = buildRosterAssignments({
      staff, nDays: 8, leaveByUserDay: {}, blockedUserIds: [],
      trainingPendingUserIds: ["pending"],
    });
    // The flat 8-day ROTATION would otherwise put this person on real M/A/N
    // duty for 6 of 8 days — none of that should leak through while
    // training-pending and unpatterned.
    expect(result.assignments.every(a => a.code === "O")).toBe(true);
  });

  it("still follows an explicit admin Staff Allocation pattern for a training-pending staff member", () => {
    const staff = [{ id: "pending", category: "B1" }];
    const patternByUser = { pending: { codes: ["G", "G", "O"], offset: 0 } };
    const result = buildRosterAssignments({
      staff, nDays: 3, leaveByUserDay: {}, blockedUserIds: [], patternByUser,
      trainingPendingUserIds: ["pending"],
    });
    // The station's own deliberate admin-duty pattern is respected — not
    // overridden to all-OFF the way an unpatterned training-pending staff
    // member's flat rotation is.
    expect(result.assignments.map(a => a.code)).toEqual(["G", "G", "O"]);
  });

  it("never pulls a training-pending staff member via the flexi fallback, even when they're the only one OFF", () => {
    const staff = [{ id: "pending", category: "B1" }];
    const patternByUser = { pending: { codes: ["G", "G", "O"], offset: 0 } };
    const result = buildRosterAssignments({
      staff, nDays: 3, leaveByUserDay: {}, blockedUserIds: [], patternByUser, lmpmLockedUserIds: [],
      trainingPendingUserIds: ["pending"],
    });
    // Day 3's OFF day is never touched by flexi — the training-pending
    // exclusion applies even to the last-resort fallback, not just
    // ordinary redistribution.
    expect(result.assignments[2].code).toBe("O");
    expect(result.flexiAssignments).toHaveLength(0);
    expect(result.violations.some(v => v.day === 3)).toBe(true);
  });
});

describe("buildCategoryCycle — demand-weighted base rotation per category", () => {
  function flatDemand(byShift, nDays) {
    const d = {};
    for (let day = 1; day <= nDays; day++) d[day] = { M: { X: byShift.M }, A: { X: byShift.A }, N: { X: byShift.N } };
    return d;
  }

  it("reproduces the exact original flat ROTATION for a perfectly even 1:1:1 M:A:N category", () => {
    const cycle = buildCategoryCycle("X", flatDemand({ M: 1, A: 1, N: 1 }, 10), 10);
    expect(cycle).toEqual(ROTATION);
  });

  it("falls back to the flat ROTATION when there's no computed demand at all for this category (e.g. STO)", () => {
    expect(buildCategoryCycle("STO", {}, 10)).toEqual(ROTATION);
    expect(buildCategoryCycle("STO", undefined, 10)).toEqual(ROTATION);
  });

  it("weights toward Night for a Night-dominant category (B2-like), at the cost of overall on-duty cadence", () => {
    // Real demand ~0 Morning/Afternoon, 1 Night — matches a station's B2
    // Mandatory Coverage commonly being Night-only.
    const cycle = buildCategoryCycle("X", flatDemand({ M: 0, A: 0, N: 1 }, 10), 10);
    expect(cycle).toEqual(["N", "N", "O", "O"]);
    // 50% on-duty — below the original rotation's 75% — is the direct,
    // intended consequence of the hard "2 nights -> 2 forced rest days"
    // rule: an all-Night cycle can never clear 50% no matter how it's
    // shaped, confirmed directly with the user as the right tradeoff.
    const onDays = cycle.filter(c => c !== "O").length;
    expect(onDays / cycle.length).toBeCloseTo(0.5, 5);
  });

  it("weights toward Morning/Afternoon, proportionally to their own demand, for a Night-light category", () => {
    const cycle = buildCategoryCycle("X", flatDemand({ M: 3, A: 1, N: 0 }, 10), 10);
    // No Night demand at all -> no forced-rest overhead; Morning gets
    // roughly 3x Afternoon's slots, matching the 3:1 real demand ratio.
    expect(cycle.filter(c => c === "M").length).toBeGreaterThan(cycle.filter(c => c === "A").length);
    expect(cycle).not.toContain("N");
  });

  it("shifts the Night share of on-duty days up for a category between the two extremes (NCS-like), still never exceeding a legal 2-consecutive-night run", () => {
    // Roughly this session's real NCS numbers: M 2.1, A 2.0, N 4.0.
    const cycle = buildCategoryCycle("X", flatDemand({ M: 2.1, A: 2.0, N: 4.0 }, 10), 10);
    const nightShareOfOnDays = cycle.filter(c => c === "N").length / cycle.filter(c => c !== "O").length;
    const originalNightShare = ROTATION.filter(c => c === "N").length / ROTATION.filter(c => c !== "O").length; // 2/6
    expect(nightShareOfOnDays).toBeGreaterThan(originalNightShare);
    // Never more than 2 N's in a row anywhere the cycle repeats (checked
    // across two concatenated copies, so the wrap-around join is covered
    // too).
    const doubled = [...cycle, ...cycle].join(",");
    expect(doubled).not.toMatch(/N,N,N/);
  });
});

describe("buildRosterAssignments — demand-weighted base rotation, end to end", () => {
  it("gives a Night-dominant category (B2-like) mostly Night duty with more OFF days, instead of an even M/A/N split", () => {
    const staff = makeStaff(2, "B2");
    const advisoryDemand = {};
    for (let d = 1; d <= 16; d++) advisoryDemand[d] = { M: { B2: 0 }, A: { B2: 0 }, N: { B2: 1 } };
    const result = buildRosterAssignments({ staff, nDays: 16, leaveByUserDay: {}, blockedUserIds: [], advisoryDemand });
    const codes = result.assignments.map(a => a.code);
    expect(codes.filter(c => c === "M").length).toBe(0);
    expect(codes.filter(c => c === "A").length).toBe(0);
    expect(codes.filter(c => c === "N").length).toBeGreaterThan(0);
    // Meaningfully below the old flat rotation's 75% on-duty cadence.
    const onDutyRatio = codes.filter(c => c === "N").length / codes.length;
    expect(onDutyRatio).toBeLessThan(0.6);
  });
});
