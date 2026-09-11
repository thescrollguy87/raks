jest.mock("../src/repositories/rosterRepository");

const rosterRepo = require("../src/repositories/rosterRepository");
const baRosterService = require("../src/services/baRosterService");

describe("baRosterService.buildBARosterRows", () => {
  it("throws 404 when no roster exists for the month", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(null);
    await expect(baRosterService.buildBARosterRows("station-1", "2026-09-05"))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  // The BA test portal's upload format requires an "Email ID" column (see
  // BA_EXPORT_HEADER) — this must come from the export-specific repo query
  // (getRosterGridForExport), not the general getRosterGrid the web grid
  // uses, which deliberately omits email for everyone with roster:read.
  it("includes each staff member's email in the exported row", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.findStationById.mockResolvedValue({ iataCode: "AMD" });
    rosterRepo.getRosterGridForExport.mockResolvedValue([
      {
        id: "s1", fullName: "Rakesh Patel", email: "rakesh.patel@akasaair.com",
        category: "B1", designation: "Sr. AME", department: "M&E", employeeId: "700577",
        shiftAssignments: [
          { shiftDate: new Date("2026-09-05T00:00:00.000Z"), shiftDef: { code: "M", name: "Morning", type: "duty", startTime: "06:30", endTime: "14:00" }, in1: null, out1: null },
        ],
      },
    ]);

    const rows = await baRosterService.buildBARosterRows("station-1", "2026-09-05");

    expect(rows).toHaveLength(1);
    expect(rows[0][3]).toBe("rakesh.patel@akasaair.com"); // "Email ID" is the 4th column
    expect(rosterRepo.getRosterGridForExport).toHaveBeenCalledWith("station-1", "roster-1");
  });

  it("exports an empty string, never undefined, when a staff member has no email on file", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.findStationById.mockResolvedValue({ iataCode: "AMD" });
    rosterRepo.getRosterGridForExport.mockResolvedValue([
      {
        id: "s1", fullName: "No Email Staffer", email: null,
        category: "B1", designation: "AME", department: "M&E", employeeId: "700999",
        shiftAssignments: [
          { shiftDate: new Date("2026-09-05T00:00:00.000Z"), shiftDef: { code: "A", name: "Afternoon", type: "duty", startTime: "13:30", endTime: "21:30" }, in1: null, out1: null },
        ],
      },
    ]);

    const rows = await baRosterService.buildBARosterRows("station-1", "2026-09-05");

    expect(rows[0][3]).toBe("");
  });
});
