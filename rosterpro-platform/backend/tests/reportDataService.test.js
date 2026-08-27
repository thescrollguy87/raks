jest.mock("../src/repositories/rosterRepository");
jest.mock("../src/services/complianceService");
jest.mock("../src/services/leaveService");

const rosterRepo = require("../src/repositories/rosterRepository");
const complianceService = require("../src/services/complianceService");
const reportDataService = require("../src/services/reportDataService");

describe("reportDataService.daysInMonth / dateLabel", () => {
  it("computes days in month correctly, including leap years", () => {
    expect(reportDataService.daysInMonth("2026-09")).toBe(30);
    expect(reportDataService.daysInMonth("2026-02")).toBe(28);
    expect(reportDataService.daysInMonth("2028-02")).toBe(29);
  });
  it("labels dates in ISO format", () => {
    expect(reportDataService.dateLabel("2026-09", 1)).toBe("2026-09-01");
    expect(reportDataService.dateLabel("2026-09", 30)).toBe("2026-09-30");
  });
});

describe("reportDataService.getRosterReportData", () => {
  it("throws 404 when no roster exists for the month", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(null);
    await expect(reportDataService.getRosterReportData("station-1", "2026-09"))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("builds a header/row grid with shift codes on the right days and O elsewhere", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1", isPublished: true });
    rosterRepo.getRosterGrid.mockResolvedValue([{
      id: "s1", fullName: "RAKESH PATEL", category: "B1", designation: "STN I/C",
      shiftAssignments: [
        { shiftDate: new Date("2026-09-01T00:00:00.000Z"), shiftDef: { code: "M" } },
        { shiftDate: new Date("2026-09-03T00:00:00.000Z"), shiftDef: { code: "N" } },
      ],
    }]);

    const report = await reportDataService.getRosterReportData("station-1", "2026-09");

    expect(report.header).toHaveLength(4 + 30);
    expect(report.rows[0][4]).toBe("M"); // day 1
    expect(report.rows[0][5]).toBe("O"); // day 2 - no assignment
    expect(report.rows[0][6]).toBe("N"); // day 3
  });
});

describe("reportDataService.getComplianceReportData", () => {
  it("sorts EXPIRED records first regardless of staff name order", async () => {
    rosterRepo.getActiveStaffContacts.mockResolvedValue([
      { id: "s1", fullName: "Zed Staff" },
      { id: "s2", fullName: "Alice Staff" },
    ]);
    complianceService.getComplianceSummary.mockImplementation(async (id) => {
      if (id === "s1") return { qualifications: [{ qualCode: "B737", expiryDate: new Date("2027-01-01"), status: "VALID" }], licenses: [], trainings: [] };
      return { qualifications: [{ qualCode: "A320", expiryDate: new Date("2026-01-01"), status: "EXPIRED" }], licenses: [], trainings: [] };
    });

    const report = await reportDataService.getComplianceReportData("station-1");

    expect(report.rows[0][4]).toBe("EXPIRED");
    expect(report.rows[0][0]).toBe("Alice Staff");
  });
});
