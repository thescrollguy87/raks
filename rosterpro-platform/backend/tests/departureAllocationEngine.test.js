const { resolveRosterShiftForDeparture, allocateDepartureManpower } = require("../src/utils/departureAllocationEngine");

// Matches the user's own worked example: Morning 07:00-14:00, Afternoon
// 14:00-21:30, Night 21:30-07:00 (crosses midnight).
const SHIFT_DEFS = {
  M: { start: "07:00", end: "14:00" },
  A: { start: "14:00", end: "21:30" },
  N: { start: "21:30", end: "07:00" },
};

describe("resolveRosterShiftForDeparture — which real roster row covers a departure", () => {
  it("a 04:00-06:00 early-morning departure resolves to Night, filed on the PREVIOUS calendar day (still on duty till 07:00)", () => {
    expect(resolveRosterShiftForDeparture(4 * 60, SHIFT_DEFS)).toEqual({ shiftCode: "N", dayOffset: -1 });
    expect(resolveRosterShiftForDeparture(6 * 60, SHIFT_DEFS)).toEqual({ shiftCode: "N", dayOffset: -1 });
  });

  it("a departure at exactly 07:00 belongs to Morning on the SAME day (Night's window ends there)", () => {
    expect(resolveRosterShiftForDeparture(7 * 60, SHIFT_DEFS)).toEqual({ shiftCode: "M", dayOffset: 0 });
  });

  it("a 09:00 departure resolves to Morning, same day", () => {
    expect(resolveRosterShiftForDeparture(9 * 60, SHIFT_DEFS)).toEqual({ shiftCode: "M", dayOffset: 0 });
  });

  it("a 15:00 departure resolves to Afternoon, same day", () => {
    expect(resolveRosterShiftForDeparture(15 * 60, SHIFT_DEFS)).toEqual({ shiftCode: "A", dayOffset: 0 });
  });

  it("a 22:00 departure resolves to Night, SAME day (the head of the overnight window, not the tail)", () => {
    expect(resolveRosterShiftForDeparture(22 * 60, SHIFT_DEFS)).toEqual({ shiftCode: "N", dayOffset: 0 });
  });

  it("returns null when the time falls in no configured shift at all", () => {
    expect(resolveRosterShiftForDeparture(9 * 60, { M: { start: "07:00", end: "08:00" } })).toBeNull();
  });
});

describe("allocateDepartureManpower — draws only from the caller-resolved roster-shift pool per departure", () => {
  it("assigns 1 releaser (B1 or CM) + 1 NCS to a single departure from its own pool", () => {
    const departures = [{ key: "turn:1", depMin: 540, poolKey: "M:2026-09-03", releaserB1: ["b1-1"], releaserCM: ["cm-1"], supportNCS: ["ncs-1"] }];
    const result = allocateDepartureManpower(departures, 60);
    expect(result).toHaveLength(1);
    expect(result[0].releaserUserId).toBe("b1-1");
    expect(result[0].releaserCategory).toBe("B1");
    expect(result[0].supportUserId).toBe("ncs-1");
    expect(result[0].unfilled).toBe(false);
  });

  it("an early-morning departure only draws from the PREVIOUS day's Night crew, never today's Morning crew", () => {
    // A 05:00 departure resolved (by the caller) to N:2026-09-02's crew,
    // and a 10:00 departure the same real day resolved to M:2026-09-03's
    // crew — completely disjoint pools, matching the exact scenario
    // described: the two must never share or clash on the same people
    // since they're staffed from different shifts entirely.
    const departures = [
      { key: "d-early", depMin: 5 * 60, poolKey: "N:2026-09-02", releaserB1: ["night-b1"], releaserCM: [], supportNCS: ["night-ncs"] },
      { key: "d-morning", depMin: 10 * 60, poolKey: "M:2026-09-03", releaserB1: ["morning-b1"], releaserCM: [], supportNCS: ["morning-ncs"] },
    ];
    const result = allocateDepartureManpower(departures, 60);
    const early = result.find(r => r.key === "d-early");
    const morning = result.find(r => r.key === "d-morning");
    expect(early.releaserUserId).toBe("night-b1");
    expect(morning.releaserUserId).toBe("morning-b1");
  });

  it("reuses the SAME releaser across two departures sharing a poolKey that do NOT clash", () => {
    const departures = [
      { key: "d1", depMin: 540, poolKey: "M:2026-09-03", releaserB1: ["b1-1"], releaserCM: [], supportNCS: ["ncs-1"] },
      { key: "d2", depMin: 700, poolKey: "M:2026-09-03", releaserB1: ["b1-1"], releaserCM: [], supportNCS: ["ncs-1"] }, // 160 min apart — no clash
    ];
    const result = allocateDepartureManpower(departures, 60);
    expect(result[0].releaserUserId).toBe("b1-1");
    expect(result[1].releaserUserId).toBe("b1-1");
  });

  it("never assigns the same releaser to two departures in the same crew that DO clash — must use a different person", () => {
    const departures = [
      { key: "d1", depMin: 540, poolKey: "M:2026-09-03", releaserB1: ["b1-1"], releaserCM: ["cm-1"], supportNCS: ["ncs-1", "ncs-2"] },
      { key: "d2", depMin: 570, poolKey: "M:2026-09-03", releaserB1: ["b1-1"], releaserCM: ["cm-1"], supportNCS: ["ncs-1", "ncs-2"] }, // 30 min apart — clash
    ];
    const result = allocateDepartureManpower(departures, 60);
    expect(result[0].releaserUserId).toBe("b1-1");
    expect(result[1].releaserUserId).toBe("cm-1"); // B1 already busy on the clashing window — falls back to CM
    expect(result[0].supportUserId).not.toBe(result[1].supportUserId);
  });

  it("reports unfilled when the resolved crew's pool is exhausted for a clash, with reason all_busy_with_clash", () => {
    // Reproduces the exact real-world case: two 04:50 departures consume
    // both available B1/CM, and a 05:45 departure 55 minutes later still
    // falls inside the clash window and finds nobody left.
    const departures = [
      { key: "d1", depMin: 290, poolKey: "N:2026-09-02", releaserB1: ["b1-1"], releaserCM: ["cm-1"], supportNCS: ["ncs-1", "ncs-2", "ncs-3"] },
      { key: "d2", depMin: 290, poolKey: "N:2026-09-02", releaserB1: ["b1-1"], releaserCM: ["cm-1"], supportNCS: ["ncs-1", "ncs-2", "ncs-3"] },
      { key: "d3", depMin: 345, poolKey: "N:2026-09-02", releaserB1: ["b1-1"], releaserCM: ["cm-1"], supportNCS: ["ncs-1", "ncs-2", "ncs-3"] },
    ];
    const result = allocateDepartureManpower(departures, 60);
    expect(result.filter(r => !r.unfilled)).toHaveLength(2);
    const failed = result.find(r => r.unfilled);
    expect(failed.releaserUserId).toBeNull();
    expect(failed.releaserUnfilledReason).toBe("all_busy_with_clash");
    expect(failed.supportUnfilledReason).toBeNull(); // 3 NCS were available — support WAS filled
  });

  it("an empty roster-shift pool (nobody rostered on that shift) leaves the departure unfilled with reason no_one_rostered", () => {
    const departures = [{ key: "d1", depMin: 300, poolKey: "N:2026-09-02", releaserB1: [], releaserCM: [], supportNCS: [] }];
    const result = allocateDepartureManpower(departures, 60);
    expect(result[0].releaserUserId).toBeNull();
    expect(result[0].releaserUnfilledReason).toBe("no_one_rostered");
    expect(result[0].supportUserId).toBeNull();
    expect(result[0].supportUnfilledReason).toBe("no_one_rostered");
    expect(result[0].unfilled).toBe(true);
  });

  it("round-robins across a pool of several eligible, non-clashing releasers instead of always picking the first", () => {
    const departures = [
      { key: "d1", depMin: 100, poolKey: "M:2026-09-03", releaserB1: ["b1-1", "b1-2", "b1-3"], releaserCM: [], supportNCS: ["ncs-1", "ncs-2", "ncs-3"] },
      { key: "d2", depMin: 300, poolKey: "M:2026-09-03", releaserB1: ["b1-1", "b1-2", "b1-3"], releaserCM: [], supportNCS: ["ncs-1", "ncs-2", "ncs-3"] },
      { key: "d3", depMin: 500, poolKey: "M:2026-09-03", releaserB1: ["b1-1", "b1-2", "b1-3"], releaserCM: [], supportNCS: ["ncs-1", "ncs-2", "ncs-3"] },
    ];
    const result = allocateDepartureManpower(departures, 60);
    const releasers = result.map(r => r.releaserUserId);
    expect(new Set(releasers).size).toBe(3); // spread across all 3, not always b1-1
  });

  it("keeps an existing (manually-assigned) pick as-is and does not overwrite it", () => {
    const departures = [{ key: "d1", depMin: 540, poolKey: "M:2026-09-03", releaserB1: ["b1-1"], releaserCM: ["cm-1"], supportNCS: ["ncs-1"] }];
    const existing = { d1: { releaserUserId: "cm-1", releaserCategory: "CM", supportUserId: "ncs-1" } };
    const result = allocateDepartureManpower(departures, 60, existing);
    expect(result[0].releaserUserId).toBe("cm-1");
    expect(result[0].releaserCategory).toBe("CM");
  });

  it("still blocks a clashing departure from reusing a manually-assigned person's window", () => {
    const departures = [
      { key: "d1", depMin: 540, poolKey: "M:2026-09-03", releaserB1: ["b1-1"], releaserCM: [], supportNCS: ["ncs-1"] },
      { key: "d2", depMin: 560, poolKey: "M:2026-09-03", releaserB1: ["b1-1"], releaserCM: [], supportNCS: ["ncs-1"] }, // 20 min apart — clash
    ];
    const existing = { d1: { releaserUserId: "b1-1", releaserCategory: "B1", supportUserId: "ncs-1" } };
    const result = allocateDepartureManpower(departures, 60, existing);
    expect(result[0].releaserUserId).toBe("b1-1"); // kept as manually assigned
    expect(result[1].releaserUserId).toBeNull(); // no other B1/CM in this crew — correctly unfilled, not double-booked
    expect(result[1].unfilled).toBe(true);
  });
});
