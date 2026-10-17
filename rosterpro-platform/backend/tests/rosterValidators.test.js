const { upsertShiftDefSchema } = require("../src/validators/rosterValidators");
const { PEOPLESTRONG_SHIFT_LIST } = require("../src/data/peopleStrongShiftList");

const BASE = { code: "G", name: "General", breakMin: 0, type: "duty" };

describe("upsertShiftDefSchema.peopleStrongLabel", () => {
  it("accepts a real Shift_List entry", () => {
    const result = upsertShiftDefSchema.safeParse({ ...BASE, peopleStrongLabel: PEOPLESTRONG_SHIFT_LIST[0] });
    expect(result.success).toBe(true);
  });

  it("accepts an empty string — explicitly unmapped", () => {
    const result = upsertShiftDefSchema.safeParse({ ...BASE, peopleStrongLabel: "" });
    expect(result.success).toBe(true);
  });

  it("accepts null and omission — unmapped, same as empty string", () => {
    expect(upsertShiftDefSchema.safeParse({ ...BASE, peopleStrongLabel: null }).success).toBe(true);
    expect(upsertShiftDefSchema.safeParse(BASE).success).toBe(true);
  });

  it("rejects a string that isn't a real Shift_List entry — never silently guessed at", () => {
    const result = upsertShiftDefSchema.safeParse({ ...BASE, peopleStrongLabel: "Not A Real Label" });
    expect(result.success).toBe(false);
  });
});
