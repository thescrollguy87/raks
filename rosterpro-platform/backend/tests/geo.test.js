const { haversineMeters, rankLocationsByDistance, looksLikeMockLocation } = require("../src/utils/geo");

describe("haversineMeters", () => {
  it("returns ~0 for the same point", () => {
    expect(haversineMeters(23.0225, 72.5714, 23.0225, 72.5714)).toBeCloseTo(0, 1);
  });

  it("computes a realistic distance for two known points", () => {
    // Roughly 1 degree of latitude ≈ 111km
    const d = haversineMeters(23.0225, 72.5714, 24.0225, 72.5714);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
});

describe("rankLocationsByDistance", () => {
  it("sorts nearest first", () => {
    const locations = [
      { id: "far", latitude: 24.0225, longitude: 72.5714, radiusMeters: 200 },
      { id: "near", latitude: 23.0226, longitude: 72.5714, radiusMeters: 200 },
    ];
    const ranked = rankLocationsByDistance(23.0225, 72.5714, locations);
    expect(ranked[0].location.id).toBe("near");
    expect(ranked[0].distanceM).toBeLessThan(ranked[1].distanceM);
  });
});

describe("looksLikeMockLocation", () => {
  it("flags exactly-zero accuracy", () => {
    expect(looksLikeMockLocation({ accuracy: 0, nearestDistanceM: 50 })).toBe(true);
  });

  it("flags a suspiciously round low accuracy", () => {
    expect(looksLikeMockLocation({ accuracy: 3, nearestDistanceM: 50 })).toBe(true);
  });

  it("flags an exact zero-distance match to a configured location", () => {
    expect(looksLikeMockLocation({ accuracy: 15.7, nearestDistanceM: 0 })).toBe(true);
  });

  it("does not flag a normal real-world GPS reading", () => {
    expect(looksLikeMockLocation({ accuracy: 12.4, nearestDistanceM: 43.2 })).toBe(false);
  });
});
