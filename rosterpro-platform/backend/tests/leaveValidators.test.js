const { decideLeaveSchema, updateLeaveSchema } = require("../src/validators/leaveValidators");

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

describe("updateLeaveSchema", () => {
  it("accepts a full edit of type/dates/reason", () => {
    const result = updateLeaveSchema.safeParse({ leaveType: "DEPUTATION", fromDate: "2026-11-10", toDate: "2026-11-25", reason: "Extended at AMD's request" });
    expect(result.success).toBe(true);
  });

  it("rejects fromDate after toDate", () => {
    const result = updateLeaveSchema.safeParse({ leaveType: "DEPUTATION", fromDate: "2026-11-25", toDate: "2026-11-10" });
    expect(result.success).toBe(false);
  });

  it("rejects a userId field — an edit never reassigns the entry to someone else", () => {
    const result = updateLeaveSchema.safeParse({ userId: "someone-else", leaveType: "DEPUTATION", fromDate: "2026-11-10", toDate: "2026-11-25" });
    // userId is simply not part of this schema's shape — it's silently
    // stripped by zod's default behavior, not an error, so this just
    // confirms the schema itself has no such field to accidentally honor.
    expect(result.success).toBe(true);
    expect(result.data.userId).toBeUndefined();
  });

  it("requires leaveType/fromDate/toDate", () => {
    expect(updateLeaveSchema.safeParse({}).success).toBe(false);
  });
});
