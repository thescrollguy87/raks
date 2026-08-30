const {
  decodeDaysOfWeek, excelCellToMinutes, excelCellToDate, minutesToHHMM,
  findHeaderRow, parseTurnReportRows, parseCharterRows, expandOperatingDates,
  computeFlightWorkloadSummary, buildDailyFlightSchedule,
} = require("../src/utils/flightScheduleParser");

describe("decodeDaysOfWeek — Excel's type-mangling of the 7-char days-of-week code", () => {
  it("decodes a plain string pattern (Excel couldn't parse it as a number)", () => {
    expect(decodeDaysOfWeek("1.34.6.")).toEqual({ pattern: "1.34.6.", days: [true, false, true, true, false, true, false] });
  });
  it("decodes a number Excel parsed with no leading dot (all 7 days operate)", () => {
    expect(decodeDaysOfWeek(1234567)).toEqual({ pattern: "1234567", days: [true, true, true, true, true, true, true] });
  });
  it("decodes a number with a leading-dot pattern that Excel turned into 0.234567", () => {
    // Original pattern ".234567" (Monday off) -> Excel stores as the number 0.234567
    expect(decodeDaysOfWeek(0.234567)).toEqual({ pattern: ".234567", days: [false, true, true, true, true, true, true] });
  });
  it("decodes a number with a mid-pattern dot that Excel turned into e.g. 123.567", () => {
    // Original "123.567" (Thursday off)
    expect(decodeDaysOfWeek(123.567)).toEqual({ pattern: "123.567", days: [true, true, true, false, true, true, true] });
  });
  it("pads a short numeric pattern with trailing dots Excel's numeric parsing dropped", () => {
    // "12345.." would parse as the number 12345 - trailing dots dropped
    expect(decodeDaysOfWeek(12345)).toEqual({ pattern: "12345..", days: [true, true, true, true, true, false, false] });
  });
  it("returns null for blank/missing values", () => {
    expect(decodeDaysOfWeek(null)).toBeNull();
    expect(decodeDaysOfWeek(undefined)).toBeNull();
    expect(decodeDaysOfWeek("")).toBeNull();
  });
});

describe("excelCellToMinutes — defensive multi-format time parsing", () => {
  it("parses a pure Excel time fraction (<1)", () => {
    expect(excelCellToMinutes(0.5)).toBe(720); // 12:00
    expect(excelCellToMinutes(0.25)).toBe(360); // 06:00
  });
  it("parses a date+time serial, taking only the time part", () => {
    expect(excelCellToMinutes(46000.5)).toBe(720);
  });
  it("parses a JS Date object using UTC hours/minutes", () => {
    const d = new Date(Date.UTC(2026, 8, 1, 14, 30));
    expect(excelCellToMinutes(d)).toBe(14 * 60 + 30);
  });
  it("parses an HH:MM string", () => {
    expect(excelCellToMinutes("06:30")).toBe(390);
    expect(excelCellToMinutes("23:45")).toBe(1425);
  });
  it("parses a Ground Time duration cell the same way (4:30 means 4h30m, not 4:30am)", () => {
    expect(excelCellToMinutes("04:30")).toBe(270);
  });
  it("returns null for blank/unparseable values", () => {
    expect(excelCellToMinutes(null)).toBeNull();
    expect(excelCellToMinutes("")).toBeNull();
    expect(excelCellToMinutes("garbage")).toBeNull();
  });
});

describe("excelCellToDate — defensive multi-format date parsing", () => {
  it("parses an Excel date serial number", () => {
    // Serial 46000 = 2025-12-25ish; just check round-trip sanity via a known serial
    const d = excelCellToDate(45900); // some date in 2025
    expect(d).toBeInstanceOf(Date);
  });
  it("parses a DD-MM-YYYY string", () => {
    const d = excelCellToDate("15-09-2026");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // September = index 8
    expect(d.getDate()).toBe(15);
  });
  it("parses a DD/MM/YYYY string", () => {
    const d = excelCellToDate("01/09/2026");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(1);
  });
  it("returns null for blank values", () => {
    expect(excelCellToDate(null)).toBeNull();
    expect(excelCellToDate("")).toBeNull();
  });
});

describe("findHeaderRow — locates by content, not fixed position", () => {
  it("finds the header row even with a title banner before it", () => {
    const rows = [["AMD Turn Report — September 2026"], ["Inbound Aln", "Inbound Flt"], ["6E", "123"]];
    expect(findHeaderRow(rows, "Inbound Aln")).toBe(1);
  });
  it("returns -1 when the expected header text is nowhere in the first 15 rows", () => {
    const rows = [["Nothing"], ["Relevant"], ["Here"]];
    expect(findHeaderRow(rows, "Inbound Aln")).toBe(-1);
  });
});

// Builds a synthetic sheet mimicking the real file's shape: a title banner
// row, a header row, then a mix of real data rows and blank filler rows —
// far more blank rows than data rows, matching what the real Turn Report
// actually looks like.
function buildSyntheticTurnSheet(dataRowCount, blankRowCount) {
  const rows = [
    ["AMD Turn Report"],
    ["Inbound Aln", "Inbound Flt", "Inbound Dep Sta", "Inbound Dep", "Inbound Arr Sta", "Inbound Arr", "Ground Time",
      "Outbound Dep Sta", "Outbound Flt", "Outbound Dep", "Outbound Arr Sta", "Outbound Arr",
      "Effective Date", "Discontinue Date", "Days of Week", "Remark"],
  ];
  for (let i = 0; i < dataRowCount; i++) {
    rows.push(["6E", `${100 + i}`, "BOM", "06:00", "AMD", "07:00", "00:40",
      "AMD", `${200 + i}`, "07:40", "DEL", "09:00",
      "01-09-2026", "30-09-2026", "1234567", ""]);
  }
  for (let i = 0; i < blankRowCount; i++) rows.push([]);
  return rows;
}

describe("parseTurnReportRows — skips blank filler rows (verification case 1)", () => {
  it("parses far fewer records than raw rows when the sheet has heavy blank-row padding", () => {
    // Mirrors the real file's shape: 20 real data rows buried in 1000 blank rows.
    const rows = buildSyntheticTurnSheet(20, 1000);
    const result = parseTurnReportRows(rows);
    expect(result.error).toBeNull();
    expect(result.records).toHaveLength(20); // NOT 1022 (header + banner + all rows)
    expect(rows.length).toBeGreaterThan(1000);
    expect(result.records.length).toBeLessThan(rows.length / 10);
  });

  it("reports a clear error when the header row can't be found at all", () => {
    const result = parseTurnReportRows([["nothing"], ["relevant"]]);
    expect(result.error).toMatch(/Inbound Aln/);
    expect(result.records).toEqual([]);
  });

  it("decodes ground time, dates, and the days-of-week pattern for each real row", () => {
    const rows = buildSyntheticTurnSheet(1, 0);
    const { records } = parseTurnReportRows(rows);
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.groundTimeMin).toBe(40);
    expect(r.inboundArrMin).toBe(420); // 07:00
    expect(r.outboundDepMin).toBe(460); // 07:40
    expect(r.daysOfWeek.pattern).toBe("1234567");
    expect(r.effectiveDate.getFullYear()).toBe(2026);
  });
});

describe("parseCharterRows — optional sheet, different layout", () => {
  it("returns no error and no records when the charter sheet doesn't exist", () => {
    const result = parseCharterRows([["unrelated"], ["data"]]);
    expect(result.error).toBeNull();
    expect(result.records).toEqual([]);
  });

  it("parses charter rows when the sheet is present, skipping blanks", () => {
    const rows = [
      ["Charter Flights"], [], [], [], [],
      ["Sl", "Flt Desg", "Effective", "Discontinue", "DOW", "Dep Sta", "Dep", "Arr Sta", "Arr", "Service Type"],
      [1, "CH001", "01-09-2026", "30-09-2026", "1234567", "AMD", "10:00", "BOM", "11:00", "Charter"],
      [],
      [],
    ];
    const result = parseCharterRows(rows);
    expect(result.error).toBeNull();
    expect(result.records).toHaveLength(1);
    expect(result.records[0].flightDesg).toBe("CH001");
    expect(result.records[0].depMin).toBe(600);
  });
});

describe("expandOperatingDates", () => {
  it("expands a full-week pattern across an entire month", () => {
    const eff = new Date(2026, 8, 1), disc = new Date(2026, 8, 30);
    const dow = decodeDaysOfWeek(1234567);
    const dates = expandOperatingDates(eff, disc, dow, 2026, 9);
    expect(dates).toHaveLength(30);
  });

  it("only expands to the days the pattern actually flags, clipped to the target month", () => {
    const eff = new Date(2026, 8, 1), disc = new Date(2026, 8, 30);
    const dow = decodeDaysOfWeek("1......"); // Monday only
    const dates = expandOperatingDates(eff, disc, dow, 2026, 9);
    dates.forEach(d => expect(d.getDay()).toBe(1)); // JS Monday = 1
  });

  it("returns an empty array when effective/discontinue dates fall entirely outside the target month", () => {
    const eff = new Date(2026, 0, 1), disc = new Date(2026, 0, 31);
    const dow = decodeDaysOfWeek(1234567);
    expect(expandOperatingDates(eff, disc, dow, 2026, 9)).toEqual([]);
  });
});

describe("computeFlightWorkloadSummary + buildDailyFlightSchedule", () => {
  it("lists every day of the month including zero-flight days", () => {
    const rows = buildSyntheticTurnSheet(1, 0); // operates all 7 days, so most days of Sept have this flight
    const { records } = parseTurnReportRows(rows);
    const { byDay, daysInMonth } = buildDailyFlightSchedule(records, [], 2026, 9);
    expect(daysInMonth).toBe(30);
    expect(Object.keys(byDay)).toHaveLength(30);
    // Every day should be present as a key even if some had zero flights (none do here, but the day list itself must be complete).
    for (let d = 1; d <= 30; d++) expect(byDay[d]).toBeDefined();
  });

  it("computes aggregate movement stats correctly", () => {
    const rows = buildSyntheticTurnSheet(1, 0);
    const { records } = parseTurnReportRows(rows);
    const summary = computeFlightWorkloadSummary(records, [], 2026, 9);
    expect(summary.operatingDays).toBe(30);
    expect(summary.totalMovements).toBe(60); // 2 movements/day (inbound+outbound) x 30 days
    expect(summary.turnRowCount).toBe(1);
  });
});
