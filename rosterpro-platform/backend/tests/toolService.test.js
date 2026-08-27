jest.mock("../src/repositories/toolRepository");
jest.mock("../src/utils/auditTrail");

const repo = require("../src/repositories/toolRepository");
const svc = require("../src/services/toolService");

// SUPER_ADMIN bypasses the station-scoping check added to this service —
// these tests are about the tool-lifecycle business logic, not
// authorization (that's covered separately, at the route/API level).
const actor = { sub: "user-1", name: "Actor", roles: ["SUPER_ADMIN"] };

describe("toolService.issueTool", () => {
  it("issues an available, valid tool", async () => {
    repo.findById.mockResolvedValue({ id: "tool-1", toolNo: "TQ-001", status: "VALID" });
    repo.findOpenIssuesForTool.mockResolvedValue([]);
    repo.createIssue.mockResolvedValue({ id: "issue-1", toolId: "tool-1" });

    const result = await svc.issueTool("tool-1", { issuedToId: "staff-1" }, actor, {});
    expect(result.id).toBe("issue-1");
  });

  it("blocks issuing a tool that's already checked out", async () => {
    repo.findById.mockResolvedValue({ id: "tool-1", toolNo: "TQ-001", status: "VALID" });
    repo.findOpenIssuesForTool.mockResolvedValue([{ id: "existing-issue" }]);

    await expect(svc.issueTool("tool-1", { issuedToId: "staff-2" }, actor, {}))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("blocks issuing a tool with overdue calibration", async () => {
    repo.findById.mockResolvedValue({ id: "tool-1", toolNo: "TQ-001", status: "OVERDUE" });
    await expect(svc.issueTool("tool-1", { issuedToId: "staff-1" }, actor, {}))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("blocks issuing a quarantined tool", async () => {
    repo.findById.mockResolvedValue({ id: "tool-1", toolNo: "TQ-001", status: "QUARANTINED" });
    await expect(svc.issueTool("tool-1", { issuedToId: "staff-1" }, actor, {}))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("toolService.returnTool", () => {
  it("returns a tool that's currently issued", async () => {
    repo.findOpenIssue.mockResolvedValue({ id: "issue-1", returnedAt: null, toolId: "tool-1", tool: { id: "tool-1", stationId: "station-1" } });
    repo.returnIssue.mockResolvedValue({ id: "issue-1", returnedAt: new Date() });

    const result = await svc.returnTool("issue-1", actor, {});
    expect(result.returnedAt).toBeTruthy();
  });

  it("blocks returning a tool issue that's already returned", async () => {
    repo.findOpenIssue.mockResolvedValue({ id: "issue-1", returnedAt: new Date(), tool: { id: "tool-1", stationId: "station-1" } });
    await expect(svc.returnTool("issue-1", actor, {})).rejects.toMatchObject({ statusCode: 409 });
  });

  it("404s on an unknown issue id", async () => {
    repo.findOpenIssue.mockResolvedValue(null);
    await expect(svc.returnTool("nope", actor, {})).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("toolService.recordCalibration", () => {
  it("logs the calibration and resets the tool to VALID with the new due date", async () => {
    repo.findById.mockResolvedValue({ id: "tool-1", status: "OVERDUE", calibrationDue: new Date("2026-01-01") });
    repo.updateStatus.mockResolvedValue({ id: "tool-1", status: "VALID" });

    await svc.recordCalibration("tool-1", { calibratedOn: "2026-09-01", nextDue: "2027-09-01" }, actor, {});

    expect(repo.addCalibrationLog).toHaveBeenCalled();
    expect(repo.updateStatus).toHaveBeenCalledWith("tool-1", "VALID", new Date("2027-09-01T00:00:00.000Z"));
  });
});
