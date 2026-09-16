const { decideRegularizationSchema, createRegularizationSchema } = require("../src/validators/regularizationValidators");

describe("decideRegularizationSchema", () => {
  it("requires a comment when rejecting", () => {
    expect(decideRegularizationSchema.safeParse({ decision: "REJECTED" }).success).toBe(false);
  });
  it("accepts a rejection with a comment", () => {
    expect(decideRegularizationSchema.safeParse({ decision: "REJECTED", reason: "Not eligible" }).success).toBe(true);
  });
  it("does not require a comment when approving", () => {
    expect(decideRegularizationSchema.safeParse({ decision: "APPROVED" }).success).toBe(true);
  });
});

describe("createRegularizationSchema", () => {
  it("only accepts the confirmed fixed reason list", () => {
    expect(createRegularizationSchema.safeParse({ date: "2026-09-10", reason: "TRAFFIC_JAM" }).success).toBe(false);
    expect(createRegularizationSchema.safeParse({ date: "2026-09-10", reason: "NETWORK_ISSUE" }).success).toBe(true);
  });
});
