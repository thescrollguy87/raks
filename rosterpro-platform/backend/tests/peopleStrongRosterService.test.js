jest.mock("../src/repositories/rosterRepository");

const rosterRepo = require("../src/repositories/rosterRepository");
const peopleStrongRosterService = require("../src/services/peopleStrongRosterService");
const { PEOPLESTRONG_SHIFT_LIST } = require("../src/data/peopleStrongShiftList");

describe("peopleStrongRosterService.buildPeopleStrongRosterData", () => {
  it("throws 404 when no roster exists for the month", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue(null);
    await expect(peopleStrongRosterService.buildPeopleStrongRosterData("station-1", "2026-11"))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("maps M/A/N/O to the exact PeopleStrong labels, by date, in DD/MM/YYYY", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([{
      id: "s1", fullName: "Rakesh Patel", category: "B1", employeeId: "700577",
      shiftAssignments: [
        { shiftDate: new Date("2026-11-01T00:00:00.000Z"), shiftDef: { code: "M" } },
        { shiftDate: new Date("2026-11-02T00:00:00.000Z"), shiftDef: { code: "A" } },
        { shiftDate: new Date("2026-11-03T00:00:00.000Z"), shiftDef: { code: "N" } },
        { shiftDate: new Date("2026-11-04T00:00:00.000Z"), shiftDef: { code: "O" } },
      ],
    }]);

    const { staff, dayLabels, warnings } = await peopleStrongRosterService.buildPeopleStrongRosterData("station-1", "2026-11");

    expect(dayLabels[0]).toBe("01/11/2026");
    expect(dayLabels[dayLabels.length - 1]).toBe("30/11/2026");
    expect(staff).toHaveLength(1);
    expect(staff[0].cells.slice(0, 4)).toEqual([
      "M&E 6/2 Blr/Bom M (0630-1400)",
      "M&E 6/2 Blr/Bom A (1330-2130)",
      "M&E 6/2 Blr/Bom N (2100-0700)",
      "Weekly Off",
    ]);
    expect(warnings).toHaveLength(0);
  });

  // Per explicit instruction: ordinary leave, training and deputation all
  // collapse onto the same "19 Shift" admin slot — PeopleStrong has no
  // concept of WHY someone wasn't on a real line shift.
  it("maps Leave, Training and Deputation all to the 19 Shift (09:00-17:30) admin slot", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([{
      id: "s1", fullName: "On Leave Staffer", category: "NCS", employeeId: "701000",
      shiftAssignments: [
        { shiftDate: new Date("2026-11-01T00:00:00.000Z"), shiftDef: { code: "L" } },
        { shiftDate: new Date("2026-11-02T00:00:00.000Z"), shiftDef: { code: "TRG" } },
        { shiftDate: new Date("2026-11-03T00:00:00.000Z"), shiftDef: { code: "D" } },
      ],
    }]);

    const { staff } = await peopleStrongRosterService.buildPeopleStrongRosterData("station-1", "2026-11");

    expect(staff[0].cells.slice(0, 3)).toEqual([
      "19  Shift (09:00 - 17:30)", "19  Shift (09:00 - 17:30)", "19  Shift (09:00 - 17:30)",
    ]);
  });

  it("treats a day with no assignment at all as Weekly Off, same as every other export", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([{
      id: "s1", fullName: "Partial Record", category: "NCS", employeeId: "701001", shiftAssignments: [],
    }]);

    const { staff } = await peopleStrongRosterService.buildPeopleStrongRosterData("station-1", "2026-11");

    expect(staff[0].cells[0]).toBe("Weekly Off");
  });

  // Per explicit instruction: a code this mapping has no PeopleStrong
  // equivalent for (a custom pattern like "G", or a variant like "M1")
  // is left BLANK in the file and reported as a warning, never guessed at.
  it("leaves a cell blank and records a warning for a code with no PeopleStrong mapping", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([{
      id: "s1", fullName: "Rakesh Patel", category: "B1", employeeId: "700577",
      shiftAssignments: [
        { shiftDate: new Date("2026-11-01T00:00:00.000Z"), shiftDef: { code: "G" } },
        { shiftDate: new Date("2026-11-02T00:00:00.000Z"), shiftDef: { code: "M1" } },
      ],
    }]);

    const { staff, warnings } = await peopleStrongRosterService.buildPeopleStrongRosterData("station-1", "2026-11");

    expect(staff[0].cells[0]).toBe("");
    expect(staff[0].cells[1]).toBe("");
    expect(warnings).toEqual([
      { employeeId: "700577", fullName: "Rakesh Patel", date: "01/11/2026", code: "G" },
      { employeeId: "700577", fullName: "Rakesh Patel", date: "02/11/2026", code: "M1" },
    ]);
  });

  // Unlike the BA Roster export (airside-only), biometric attendance
  // covers everyone physically at the station — Stores/STO staff must
  // appear here.
  it("includes Stores (STO) category staff, unlike the BA Roster export", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([{
      id: "s1", fullName: "Stores Hand", category: "STO", employeeId: "702000", shiftAssignments: [],
    }]);

    const { staff } = await peopleStrongRosterService.buildPeopleStrongRosterData("station-1", "2026-11");

    expect(staff).toHaveLength(1);
    expect(staff[0].fullName).toBe("Stores Hand");
  });

  it("keeps a staff member with no employee number on file (unlike the BA Roster export, which skips them)", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([{
      id: "s1", fullName: "No Code Yet", category: "NCS", employeeId: null, shiftAssignments: [],
    }]);

    const { staff } = await peopleStrongRosterService.buildPeopleStrongRosterData("station-1", "2026-11");

    expect(staff).toHaveLength(1);
    expect(staff[0].employeeId).toBe("");
  });
});

describe("peopleStrongRosterService.getPeopleStrongRosterWarnings", () => {
  it("returns warnings and staffCount without building a workbook", async () => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([{
      id: "s1", fullName: "Rakesh Patel", category: "B1", employeeId: "700577",
      shiftAssignments: [{ shiftDate: new Date("2026-11-01T00:00:00.000Z"), shiftDef: { code: "G" } }],
    }]);

    const result = await peopleStrongRosterService.getPeopleStrongRosterWarnings("station-1", "2026-11");

    expect(result.staffCount).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("G");
  });
});

describe("peopleStrongRosterService.generatePeopleStrongRosterExcel", () => {
  beforeEach(() => {
    rosterRepo.findRosterByStationAndMonth.mockResolvedValue({ id: "roster-1" });
    rosterRepo.getRosterGrid.mockResolvedValue([
      {
        id: "s1", fullName: "Rakesh Patel", category: "B1", employeeId: "700577",
        shiftAssignments: [{ shiftDate: new Date("2026-11-01T00:00:00.000Z"), shiftDef: { code: "M" } }],
      },
      {
        id: "s2", fullName: "Stores Hand", category: "STO", employeeId: "702000",
        shiftAssignments: [{ shiftDate: new Date("2026-11-01T00:00:00.000Z"), shiftDef: { code: "G" } }],
      },
    ]);
  });

  it("builds a real xlsx workbook with the right filename and surfaces warnings alongside it", async () => {
    const { buffer, filename, warnings, staffCount } = await peopleStrongRosterService.generatePeopleStrongRosterExcel("station-1", "2026-11");

    expect(filename).toBe("PeopleStrong_Roster_2026-11.xlsx");
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.slice(0, 2).toString("hex")).toBe("504b"); // real .xlsx (zip) signature "PK"
    expect(staffCount).toBe(2);
    expect(warnings).toHaveLength(1); // Stores Hand's "G" has no mapping
  });

  it("round-trips through ExcelJS with both sheets, the right header, and the Shift_List dropdown source", async () => {
    const ExcelJS = require("exceljs");
    const { buffer } = await peopleStrongRosterService.generatePeopleStrongRosterExcel("station-1", "2026-11");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.worksheets.map(w => w.name)).toEqual(["Template_EmployeeRosterSchedule", "Shift_List"]);

    const main = wb.getWorksheet("Template_EmployeeRosterSchedule");
    expect(main.getCell(1, 1).value).toBe("Employee Code");
    expect(main.getCell(1, 2).value).toBe("Employee Name");
    expect(main.getCell(1, 3).value).toBe("01/11/2026");
    expect(main.getCell(2, 1).value).toBe("700577");
    expect(main.getCell(2, 3).value).toBe("M&E 6/2 Blr/Bom M (0630-1400)");
    expect(main.getCell(3, 3).value).toBe(""); // Stores Hand's unmapped "G"

    const shiftList = wb.getWorksheet("Shift_List");
    expect(shiftList.rowCount).toBe(PEOPLESTRONG_SHIFT_LIST.length);
    expect(shiftList.getCell(1, 1).value).toBe(PEOPLESTRONG_SHIFT_LIST[0]);

    const dv = main.dataValidations.find("C2");
    expect(dv.type).toBe("list");
    expect(dv.formulae[0]).toContain("Shift_List!$A$1:$A$294");
  });
});
