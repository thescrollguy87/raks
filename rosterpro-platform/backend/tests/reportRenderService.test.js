const { toRosterPdfBuffer } = require("../src/services/reportRenderService");

function sampleData(staffOverrides = {}) {
  const dayLabels = [
    { day: 1, weekday: "Su", iso: "2026-11-01" },
    { day: 2, weekday: "Mo", iso: "2026-11-02" },
  ];
  return {
    meta: { iataCode: "AMD", stationName: "Ahmedabad", monthLabel: "November 2026", airlineName: "Akasa Air" },
    legend: [{ code: "M", name: "Morning", startTime: "06:30", endTime: "14:00", color: "#60CFFF" }],
    dayLabels,
    categories: [
      {
        code: "B1", label: "B1 AME",
        staff: [{
          fullName: "Rakesh Patel", designation: "Station Incharge", employeeId: "700577", category: "B1",
          days: dayLabels.map(() => ({ code: "M", hasTime: true, timeLabel: "0630-1400", color: "#60CFFF" })),
          ...staffOverrides,
        }],
      },
    ],
  };
}

describe("reportRenderService.toRosterPdfBuffer — Designation/Employee ID/Category on each staff row", () => {
  it("renders a valid, non-empty PDF buffer when every field is present", async () => {
    const buf = await toRosterPdfBuffer(sampleData());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF"); // real PDF, not a thrown/empty result
  });

  it("still renders cleanly when designation/employeeId are missing (blank strings)", async () => {
    const buf = await toRosterPdfBuffer(sampleData({ designation: "", employeeId: "" }));
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("still renders cleanly with a very long name and designation (ellipsis path)", async () => {
    const buf = await toRosterPdfBuffer(sampleData({
      fullName: "A Very Long Staff Member Full Name That Would Overflow The Column",
      designation: "An Extremely Long Designation Title That Also Would Overflow",
    }));
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
  });
});
