const { allocateDepartureManpower } = require("../src/utils/departureAllocationEngine");

describe("allocateDepartureManpower", () => {
  it("assigns 1 releaser (B1 or CM) + 1 NCS to a single departure", () => {
    const departures = [{ key: "turn:1", depMin: 540 }];
    const staffPools = { B1: ["b1-1"], CM: ["cm-1"], NCS: ["ncs-1"] };
    const result = allocateDepartureManpower(departures, staffPools, 60);
    expect(result).toHaveLength(1);
    expect(result[0].releaserUserId).toBe("b1-1"); // B1 listed first — preferred when available
    expect(result[0].releaserCategory).toBe("B1");
    expect(result[0].supportUserId).toBe("ncs-1");
    expect(result[0].unfilled).toBe(false);
  });

  it("reuses the SAME releaser across two departures that do NOT clash", () => {
    const departures = [{ key: "d1", depMin: 540 }, { key: "d2", depMin: 700 }]; // 160 min apart, well outside 60min window
    const staffPools = { B1: ["b1-1"], CM: [], NCS: ["ncs-1"] };
    const result = allocateDepartureManpower(departures, staffPools, 60);
    expect(result[0].releaserUserId).toBe("b1-1");
    expect(result[1].releaserUserId).toBe("b1-1"); // same person can cover both — they don't overlap
  });

  it("never assigns the same releaser to two departures that DO clash — must use a different person", () => {
    const departures = [{ key: "d1", depMin: 540 }, { key: "d2", depMin: 570 }]; // 30 min apart, within 60min clash window
    const staffPools = { B1: ["b1-1"], CM: ["cm-1"], NCS: ["ncs-1", "ncs-2"] };
    const result = allocateDepartureManpower(departures, staffPools, 60);
    expect(result[0].releaserUserId).toBe("b1-1");
    expect(result[1].releaserUserId).toBe("cm-1"); // B1 already busy on the clashing window — falls back to CM
    expect(result[0].releaserUserId).not.toBe(result[1].releaserUserId);
    expect(result[0].supportUserId).not.toBe(result[1].supportUserId);
  });

  it("reports unfilled when the pool is exhausted for a clash", () => {
    const departures = [{ key: "d1", depMin: 540 }, { key: "d2", depMin: 550 }, { key: "d3", depMin: 560 }]; // all mutually clashing
    const staffPools = { B1: ["b1-1"], CM: ["cm-1"], NCS: ["ncs-1", "ncs-2"] }; // only 2 releasers total for 3 clashing departures
    const result = allocateDepartureManpower(departures, staffPools, 60);
    const filledCount = result.filter(r => !r.unfilled).length;
    expect(filledCount).toBe(2);
    expect(result.filter(r => r.unfilled)).toHaveLength(1);
    expect(result.find(r => r.unfilled).releaserUserId).toBeNull();
  });

  it("round-robins across a pool of several eligible, non-clashing releasers instead of always picking the first", () => {
    const departures = [{ key: "d1", depMin: 100 }, { key: "d2", depMin: 300 }, { key: "d3", depMin: 500 }]; // all far apart, none clash
    const staffPools = { B1: ["b1-1", "b1-2", "b1-3"], CM: [], NCS: ["ncs-1", "ncs-2", "ncs-3"] };
    const result = allocateDepartureManpower(departures, staffPools, 60);
    const releasers = result.map(r => r.releaserUserId);
    expect(new Set(releasers).size).toBe(3); // spread across all 3, not always b1-1
  });

  it("keeps an existing (manually-assigned) pick as-is and does not overwrite it", () => {
    const departures = [{ key: "d1", depMin: 540 }];
    const staffPools = { B1: ["b1-1"], CM: ["cm-1"], NCS: ["ncs-1"] };
    const existing = { d1: { releaserUserId: "cm-1", releaserCategory: "CM", supportUserId: "ncs-1" } };
    const result = allocateDepartureManpower(departures, staffPools, 60, existing);
    expect(result[0].releaserUserId).toBe("cm-1");
    expect(result[0].releaserCategory).toBe("CM");
  });

  it("still blocks a clashing departure from reusing a manually-assigned person's window", () => {
    const departures = [{ key: "d1", depMin: 540 }, { key: "d2", depMin: 560 }]; // 20 min apart — clash
    const staffPools = { B1: ["b1-1"], CM: [], NCS: ["ncs-1"] };
    const existing = { d1: { releaserUserId: "b1-1", releaserCategory: "B1", supportUserId: "ncs-1" } };
    const result = allocateDepartureManpower(departures, staffPools, 60, existing);
    expect(result[0].releaserUserId).toBe("b1-1"); // kept as manually assigned
    expect(result[1].releaserUserId).toBeNull(); // no other B1/CM available — correctly unfilled, not double-booked
    expect(result[1].unfilled).toBe(true);
  });
});
