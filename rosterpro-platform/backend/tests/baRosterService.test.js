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
      "0630", "1400", // Shift Start/End Time — zero-padded 4-digit text, never a bare number (which would drop the leading zero)
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

    expect(rows[0][8]).toBe("0700");
    expect(rows[0][9]).toBe("1500");
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

  it("skips a staff member on duty with no employee number on file", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([
      {
        id: "s1", fullName: "Admin User", category: null, employeeId: null,
        shiftAssignments: [
          { shiftDate: new Date("2026-09-05T00:00:00.000Z"), shiftDef: { code: "N", name: "Night", type: "night", startTime: "21:00", endTime: "07:00" }, in1: null, out1: null },
        ],
      },
      {
        id: "s2", fullName: "Rakesh Patel", category: "B1", employeeId: "700577",
        shiftAssignments: [
          { shiftDate: new Date("2026-09-05T00:00:00.000Z"), shiftDef: { code: "M", name: "Morning", type: "duty", startTime: "06:30", endTime: "14:00" }, in1: null, out1: null },
        ],
      },
    ]);

    const rows = await baRosterService.buildBARosterRows("station-1", "2026-09-05");

    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("700577");
  });

  // Stores (STO) staff don't go airside and were never put through the
  // airport's own ground-staff access test this portal gates on —
  // confirmed directly with the user: they must never appear in this
  // export, even when genuinely on duty with a real employee number.
  it("excludes Stores (STO) category staff entirely, even when on duty with a valid employee number", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([
      {
        id: "s1", fullName: "Stores Hand", category: "STO", employeeId: "702000",
        shiftAssignments: [
          { shiftDate: new Date("2026-09-05T00:00:00.000Z"), shiftDef: { code: "M", name: "Morning", type: "duty", startTime: "06:30", endTime: "14:00" }, in1: null, out1: null },
        ],
      },
      {
        id: "s2", fullName: "Rakesh Patel", category: "B1", employeeId: "700577",
        shiftAssignments: [
          { shiftDate: new Date("2026-09-05T00:00:00.000Z"), shiftDef: { code: "M", name: "Morning", type: "duty", startTime: "06:30", endTime: "14:00" }, in1: null, out1: null },
        ],
      },
    ]);

    const rows = await baRosterService.buildBARosterRows("station-1", "2026-09-05");

    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("700577");
  });
});

describe("baRosterService.buildBARosterRows — date range (From/To)", () => {
  it("builds one row per staff per day across a multi-day range within the same month, in date order", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([
      {
        id: "s1", fullName: "Rakesh Patel", category: "B1", employeeId: "700577",
        shiftAssignments: [
          { shiftDate: new Date("2026-09-05T00:00:00.000Z"), shiftDef: { code: "M", name: "Morning", type: "duty", startTime: "06:30", endTime: "14:00" }, in1: null, out1: null },
          { shiftDate: new Date("2026-09-06T00:00:00.000Z"), shiftDef: { code: "A", name: "Afternoon", type: "duty", startTime: "13:30", endTime: "21:30" }, in1: null, out1: null },
          { shiftDate: new Date("2026-09-07T00:00:00.000Z"), shiftDef: { code: "O", name: "Off", type: "off", startTime: null, endTime: null }, in1: null, out1: null },
        ],
      },
    ]);

    const rows = await baRosterService.buildBARosterRows("station-1", "2026-09-05", "2026-09-07");

    // Day 3 is OFF, so only 2 rows — but the roster/grid was fetched once
    // for the whole month, not once per day.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["700577", 5, 9, 2026, 5, 9, 2026, "Ground Staff", "0630", "1400"]);
    expect(rows[1]).toEqual(["700577", 6, 9, 2026, 6, 9, 2026, "Ground Staff", "1330", "2130"]);
    expect(rosterRepo.findRosterByStationAndMonth).toHaveBeenCalledTimes(1);
    expect(rosterRepo.getRosterGrid).toHaveBeenCalledTimes(1);
  });

  it("fetches each spanned month's roster separately when the range crosses a month boundary", async () => {
    rosterRepo.findRosterByStationAndMonth.mockImplementation((stationId, monthKey) =>
      Promise.resolve({ id: `roster-${monthKey}` }));
    rosterRepo.getRosterGrid.mockImplementation((stationId, rosterId) => {
      const monthKey = rosterId.replace("roster-", "");
      const dateStr = monthKey === "2026-09" ? "2026-09-30" : "2026-10-01";
      return Promise.resolve([{
        id: "s1", fullName: "Rakesh Patel", category: "B1", employeeId: "700577",
        shiftAssignments: [
          { shiftDate: new Date(`${dateStr}T00:00:00.000Z`), shiftDef: { code: "M", name: "Morning", type: "duty", startTime: "06:30", endTime: "14:00" }, in1: null, out1: null },
        ],
      }]);
    });

    const rows = await baRosterService.buildBARosterRows("station-1", "2026-09-30", "2026-10-01");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["700577", 30, 9, 2026, 30, 9, 2026, "Ground Staff", "0630", "1400"]);
    expect(rows[1]).toEqual(["700577", 1, 10, 2026, 1, 10, 2026, "Ground Staff", "0630", "1400"]);
    expect(rosterRepo.findRosterByStationAndMonth).toHaveBeenCalledWith("station-1", "2026-09");
    expect(rosterRepo.findRosterByStationAndMonth).toHaveBeenCalledWith("station-1", "2026-10");
  });

  it("rejects a toDate before fromDate", async () => {
    await expect(baRosterService.buildBARosterRows("station-1", "2026-09-10", "2026-09-05"))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a range longer than the configured cap", async () => {
    await expect(baRosterService.buildBARosterRows("station-1", "2026-01-01", "2026-12-31"))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("reports which specific month in a multi-month range has no roster yet", async () => {
    rosterRepo.findRosterByStationAndMonth.mockImplementation((stationId, monthKey) =>
      Promise.resolve(monthKey === "2026-09" ? { id: "roster-1" } : null));
    rosterRepo.getRosterGrid.mockResolvedValue([]);

    await expect(baRosterService.buildBARosterRows("station-1", "2026-09-30", "2026-10-01"))
      .rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining("2026-10") });
  });
});

describe("baRosterService.generateBARosterExcel — filename reflects a single day vs. a range", () => {
  beforeEach(() => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([
      {
        id: "s1", fullName: "Rakesh Patel", category: "B1", employeeId: "700577",
        shiftAssignments: [
          { shiftDate: new Date("2026-09-05T00:00:00.000Z"), shiftDef: { code: "M", name: "Morning", type: "duty", startTime: "06:30", endTime: "14:00" }, in1: null, out1: null },
          { shiftDate: new Date("2026-09-06T00:00:00.000Z"), shiftDef: { code: "M", name: "Morning", type: "duty", startTime: "06:30", endTime: "14:00" }, in1: null, out1: null },
        ],
      },
    ]);
  });

  it("keeps the original single-date filename when only fromDate is given", async () => {
    const { filename } = await baRosterService.generateBARosterExcel("station-1", "2026-09-05");
    expect(filename).toBe("BA_Roster_2026-09-05.xlsx");
  });

  it("uses a from/to filename for a real range, in one file", async () => {
    const { buffer, filename, rowCount } = await baRosterService.generateBARosterExcel("station-1", "2026-09-05", "2026-09-06");
    expect(filename).toBe("BA_Roster_2026-09-05_to_2026-09-06.xlsx");
    expect(rowCount).toBe(2);
    expect(Buffer.isBuffer(buffer)).toBe(true);
  });
});
