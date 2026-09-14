const { decideLeaveSchema } = require("../src/validators/leaveValidators");

describe("decideLeaveSchema", () => {
  it("requires a comment when rejecting", () => {
    const result = decideLeaveSchema.safeParse({ decision: "REJECTED" });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only comment", () => {
    const result = decideLeaveSchema.safeParse({ decision: "REJECTED", reason: "   " });
    expect(result.success).toBe(false);
  });

  it("accepts a rejection with a real comment", () => {
    const result = decideLeaveSchema.safeParse({ decision: "REJECTED", reason: "Coverage gap that week" });
    expect(result.success).toBe(true);
  });

  it("does not require a comment when approving", () => {
    const result = decideLeaveSchema.safeParse({ decision: "APPROVED" });
    expect(result.success).toBe(true);
  });
});
