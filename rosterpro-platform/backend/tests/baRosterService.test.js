jest.mock("../src/repositories/rosterRepository");

const rosterRepo = require("../src/repositories/rosterRepository");
const baRosterService = require("../src/services/baRosterService");

describe("baRosterService.buildBARosterRows", () => {
  it("throws 404 when no roster exists for the month", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(null);
    await expect(baRosterService.buildBARosterRows("station-1", "2026-09-05"))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  // Matches the airport access portal's own upload template exactly
  // (Ground_Staff_Roster_April_2026.xlsx): Employee Number, Roster
  // Date/Month/Year, Roster End Date/Month/Year, Shift Role, Shift Start/
  // End Time — see BA_EXPORT_HEADER.
  it("builds a row matching the portal's column layout, with End Date equal to Date and a fixed Shift Role", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([
      {
        id: "s1", fullName: "Rakesh Patel", category: "B1", employeeId: "700577",
        shiftAssignments: [
          { shiftDate: new Date("2026-09-05T00:00:00.000Z"), shiftDef: { code: "M", name: "Morning", type: "duty", startTime: "06:30", endTime: "14:00" }, in1: null, out1: null },
        ],
      },
    ]);

    const rows = await baRosterService.buildBARosterRows("station-1", "2026-09-05");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([
      "700577",
      5, 9, 2026, // Roster Date/Month/Year
      5, 9, 2026, // Roster End Date/Month/Year — same day, no overnight adjustment
      "Ground Staff",
      630, 1400, // Shift Start/End Time — plain numbers, no zero-padding (06:30 -> 630, not "0630")
    ]);
    expect(rosterRepo.getRosterGrid).toHaveBeenCalledWith("station-1", "roster-1");
  });

  it("uses a per-day time override (in1/out1) over the shift definition's default times", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([
      {
        id: "s1", fullName: "Retimed Staffer", category: "B1", employeeId: "700999",
        shiftAssignments: [
          { shiftDate: new Date("2026-09-05T00:00:00.000Z"), shiftDef: { code: "M", name: "Morning", type: "duty", startTime: "06:30", endTime: "14:00" }, in1: "07:00", out1: "15:00" },
        ],
      },
    ]);

    const rows = await baRosterService.buildBARosterRows("station-1", "2026-09-05");

    expect(rows[0][8]).toBe(700);
    expect(rows[0][9]).toBe(1500);
  });

  it("skips a staff member whose shift that day is not a duty type (e.g. off/leave)", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([
      {
        id: "s1", fullName: "Off Duty", category: "B1", employeeId: "701000",
        shiftAssignments: [
          { shiftDate: new Date("2026-09-05T00:00:00.000Z"), shiftDef: { code: "O", name: "Off", type: "off", startTime: null, endTime: null }, in1: null, out1: null },
        ],
      },
    ]);

    const rows = await baRosterService.buildBARosterRows("station-1", "2026-09-05");

    expect(rows).toHaveLength(0);
  });
});
