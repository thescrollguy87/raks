const { shiftNetHours, segmentMinutes } = require("../src/utils/shiftHours");

describe("shiftHours.shiftNetHours", () => {
  it("computes a plain same-day shift from the shift definition alone", () => {
    const def = { startTime: "06:30", endTime: "14:00", breakMin: 0 };
    expect(shiftNetHours(def)).toBe(7.5);
  });

  it("wraps a Night shift crossing midnight correctly", () => {
    const def = { startTime: "21:00", endTime: "07:00", breakMin: 0 };
    expect(shiftNetHours(def)).toBe(10);
  });

  it("subtracts breakMin", () => {
    const def = { startTime: "06:30", endTime: "14:00", breakMin: 30 };
    expect(shiftNetHours(def)).toBe(7);
  });

  it("uses the assignment's own in1/out1 override instead of the definition's fixed timing", () => {
    const def = { startTime: "06:30", endTime: "14:00", breakMin: 0 };
    const assignment = { in1: "07:00", out1: "13:00" };
    expect(shiftNetHours(def, assignment)).toBe(6);
  });

  it("adds a second duty segment (in2/out2) for a split shift", () => {
    const def = { startTime: "06:30", endTime: "14:00", breakMin: 0 };
    const assignment = { in1: "06:00", out1: "10:00", in2: "14:00", out2: "18:00" };
    expect(shiftNetHours(def, assignment)).toBe(8);
  });

  it("returns 0 when there's no start/end at all (e.g. an OFF/Leave code)", () => {
    expect(shiftNetHours({ startTime: null, endTime: null })).toBe(0);
    expect(shiftNetHours(undefined)).toBe(0);
  });
});

describe("shiftHours.segmentMinutes", () => {
  it("returns 0 when either time is missing", () => {
    expect(segmentMinutes(null, "10:00")).toBe(0);
    expect(segmentMinutes("10:00", null)).toBe(0);
  });
});
