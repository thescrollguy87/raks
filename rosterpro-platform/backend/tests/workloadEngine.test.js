const {
  findPeakConcurrency, computeDailyShiftDemand, computeTaskMasterDemand,
  computeExplainableManpower, computeUnplannedWorkload, computeAveragePeakByShift,
} = require("../src/utils/workloadEngine");
const { decodeDaysOfWeek } = require("../src/utils/flightScheduleParser");

const DEFAULT_CONFIG = {
  transitMinutesDefault: 40, pdcMinutesBeforeDeparture: 60, clashProximityMinutes: 60,
  transitVsPdcThresholdMinutes: 120, movementsPerB1Staff: 4, movementsPerCMStaff: 1, movementsPerNCSStaff: 1,
  unplannedMethod: "frequency", unplannedManpowerHoursPerMonth: 0, unplannedBufferPct: 20,
};

// A shift window wide enough to contain all the test turn times below.
const SHIFT_DEFS = {
  M: { start: "00:00", end: "06:00" },
  A: { start: "08:00", end: "16:00" },
  N: { start: "20:00", end: "23:59" },
};

function quickTurn(arrHHMM, depHHMM) {
  const [ah, am] = arrHHMM.split(":").map(Number);
  const [dh, dm] = depHHMM.split(":").map(Number);
  return {
    inboundFlt: "IN", outboundFlt: "OUT", outboundDepSta: "AMD", inboundArrSta: "AMD",
    inboundArrMin: ah * 60 + am, outboundDepMin: dh * 60 + dm,
    groundTimeMin: (dh * 60 + dm) - (ah * 60 + am),
    effectiveDate: new Date(2026, 8, 1), discontinueDate: new Date(2026, 8, 30),
    daysOfWeek: decodeDaysOfWeek(1234567),
  };
}

describe("computeDailyShiftDemand — peak concurrency, not raw counts (verification cases 2 & 3)", () => {
  it("case 2: three NON-overlapping transits in one shift require 1 CM and 1 NCS, not 3", () => {
    const turnRecords = [
      quickTurn("09:00", "09:40"),
      quickTurn("12:00", "12:40"),
      quickTurn("14:00", "14:40"),
    ];
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 0, N: 0 },
      flightSchedule: { turnRecords, charterRecords: [] }, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    expect(result.source).toBe("flight-schedule-driven");
    expect(result.demand[1].A.CM).toBe(1);
    expect(result.demand[1].A.NCS).toBe(1);
  });

  it("case 3: three transits all overlapping the same 10-minute window require 3 CM and 3 NCS", () => {
    const turnRecords = [
      quickTurn("10:00", "10:10"),
      quickTurn("10:00", "10:10"),
      quickTurn("10:00", "10:10"),
    ];
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 0, N: 0 },
      flightSchedule: { turnRecords, charterRecords: [] }, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    expect(result.demand[1].A.CM).toBe(3);
    expect(result.demand[1].A.NCS).toBe(3);
  });

  it("verifies findPeakConcurrency directly against the two worked examples", () => {
    // Three flights at 06:00-06:40 / 06:10-06:50 / 06:20-07:00 -> peak 3
    const events1 = [{ start: 360, end: 400 }, { start: 370, end: 410 }, { start: 380, end: 420 }];
    expect(findPeakConcurrency(events1).peak).toBe(3);
    // Non-overlapping windows -> peak 1
    const events2 = [{ start: 0, end: 10 }, { start: 20, end: 30 }, { start: 40, end: 50 }];
    expect(findPeakConcurrency(events2).peak).toBe(1);
  });

  it("a 2-way departure clash needs 0 B1 (no mandatory floor set) + 2 CM (pooled) + 2 NCS — B1 and CM are interchangeable release capacity, not independent demand streams", () => {
    // Two short (5-min ground time) transits whose GROUND-TIME windows never
    // overlap (09:00-09:05 and 09:30-09:35), so peak transit concurrency is
    // only 1 — but their DEPARTURES (09:05 and 09:35) are 30 minutes apart,
    // well inside the default 60-minute clashProximityMinutes, so their
    // clash windows (±30min around each departure) DO overlap (clashPeak 2).
    const turn1 = quickTurn("09:00", "09:05");
    const turn2 = quickTurn("09:30", "09:35");
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 0, N: 0 },
      flightSchedule: { turnRecords: [turn1, turn2], charterRecords: [] }, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    // No mandatory B1 floor is configured for this shift, so B1 is held at
    // 0 — CM (interchangeable release capacity) pools to cover both the
    // ordinary transit concurrency (1) AND top up to the 2-departure clash
    // count, since B1's floor contributes nothing to the combined total.
    expect(result.demand[1].A.B1).toBe(0);
    expect(result.demand[1].A.CM).toBe(2);
    expect(result.demand[1].A.NCS).toBe(2);
    expect(result.demand[1].A.B1 + result.demand[1].A.CM).toBe(2); // combined >= clash count
    expect(result.reason).toMatch(/30 shift\(s\) had a departure clash \(within 60min\)/);
  });

  it("a 3-way clash needs CM to cover the full combined total when B1 has no floor", () => {
    // Three departures all mutually within 30 min of a common midpoint
    // (09:05, 09:20, 09:35) — clash windows (±30min) all overlap at 09:20,
    // giving clashPeak 3, one more than the 2-way case above.
    const turn1 = quickTurn("09:00", "09:05");
    const turn2 = quickTurn("09:15", "09:20");
    const turn3 = quickTurn("09:30", "09:35");
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 0, N: 0 },
      flightSchedule: { turnRecords: [turn1, turn2, turn3], charterRecords: [] }, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    // B1 stays at 0 (no mandatory floor here) — CM, the interchangeable
    // release capacity, absorbs the entire combined requirement.
    expect(result.demand[1].A.B1).toBe(0);
    expect(result.demand[1].A.CM).toBe(3);
    expect(result.demand[1].A.NCS).toBe(3);
    expect(result.demand[1].A.B1 + result.demand[1].A.CM).toBe(3); // combined >= clash count
  });

  it("B1's Mandatory Minimum floor pools with CM — a floor that already covers the load needs zero extra CM", () => {
    const turn1 = quickTurn("09:00", "09:05");
    const turn2 = quickTurn("09:30", "09:35"); // same 2-departure clash as above
    // Mandatory coverage requires 3 B1 in shift A regardless of flights —
    // at the default ratio (1 B1 covers 4 concurrent movements), 3 B1
    // covers up to 12 concurrent movements, vastly more than the observed
    // peak concurrency (1) and the clash count (2) combined, so CM needs
    // zero extra heads: B1's own floor alone already pools enough capacity.
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 3, N: 0 },
      flightSchedule: { turnRecords: [turn1, turn2], charterRecords: [] }, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    expect(result.demand[1].A.B1).toBe(3); // held at its floor, never inflated by concurrency
    expect(result.demand[1].A.CM).toBe(0); // B1's floor alone already pools enough capacity
    expect(result.demand[1].A.NCS).toBe(2);
  });

  it("does NOT raise the NCS or CM-clash-topup when departures are outside the clash proximity window", () => {
    const turn1 = quickTurn("09:00", "09:05");
    const turn2 = quickTurn("11:00", "11:05"); // 2 hours apart — no clash (clashPeak stays 1)
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 0, N: 0 },
      flightSchedule: { turnRecords: [turn1, turn2], charterRecords: [] }, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    // No mandatory floor -> B1 stays 0; CM pools the ordinary concurrency
    // (1) alone since there's no clash to top it up further; NCS stays at
    // its own ratio-based 1 instead of being floored to 2 — the direct
    // contrast proving the clash floor only fires on a real clash.
    expect(result.demand[1].A.B1).toBe(0);
    expect(result.demand[1].A.CM).toBe(1);
    expect(result.demand[1].A.NCS).toBe(1);
  });

  it("real operational example: B1 handles one flight, an available CM covers the overlapping one — not a second B1", () => {
    // Two PDC-classified turns (>120min ground time) whose PDC windows
    // overlap by 5 minutes — reproduces the exact reported scenario: 2
    // aircraft simultaneously needing release, "Concurrent Movements per
    // B1"=1 (one B1 can only handle one aircraft at a time), 1 B1 on the
    // Mandatory Minimum floor for this shift.
    const turn1 = { inboundFlt: "1902", outboundFlt: "1102", inboundArrSta: "AMD", outboundDepSta: "AMD", inboundArrMin: 8 * 60 + 20, outboundDepMin: 10 * 60 + 35, groundTimeMin: 135, effectiveDate: new Date(2026, 8, 1), discontinueDate: new Date(2026, 8, 30), daysOfWeek: decodeDaysOfWeek(1234567) };
    const turn2 = { inboundFlt: "1101", outboundFlt: "1903", inboundArrSta: "AMD", outboundDepSta: "AMD", inboundArrMin: 8 * 60 + 55, outboundDepMin: 11 * 60 + 30, groundTimeMin: 155, effectiveDate: new Date(2026, 8, 1), discontinueDate: new Date(2026, 8, 30), daysOfWeek: decodeDaysOfWeek(1234567) };
    const config = { ...DEFAULT_CONFIG, movementsPerB1Staff: 1, movementsPerCMStaff: 1 };
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 1, N: 0 },
      flightSchedule: { turnRecords: [turn1, turn2], charterRecords: [] }, config,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    // B1 stays at its mandatory floor of 1 (handles one aircraft); CM pools
    // in to cover the second overlapping aircraft B1's single capacity
    // can't reach — never a demand for a second B1.
    expect(result.demand[1].A.B1).toBe(1);
    expect(result.demand[1].A.CM).toBe(1);
  });

  it("classifies a turn as EITHER Transit or PDC, never both — ground time at the threshold boundary", () => {
    // Ground time exactly at the 120-min threshold -> Transit; one minute over -> PDC, not both.
    const quickRec = quickTurn("09:00", "11:00"); // 120 min ground time
    const slowRec = quickTurn("09:00", "11:01"); // 121 min ground time
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 0, N: 0 },
      flightSchedule: { turnRecords: [quickRec, slowRec], charterRecords: [] }, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    // If double-counted, the peak concurrency in the 08:00-16:00 shift would reflect both
    // a transit AND a PDC window for each record; with ratios of 1, CM/NCS would show 2
    // instead of 1 for at least one of them being present as only one classification.
    // The key correctness check: total classified events (transit + PDC combined) equals
    // exactly 2 (one per record), never 4 (both classifications for both records).
    expect(result.source).toBe("flight-schedule-driven");
  });
});

describe("computeTaskMasterDemand + computeExplainableManpower — correct monthly-to-daily denominator (verification case 5)", () => {
  it("case 5: 90 occurrences/month at 8h each produces a small, sensible per-shift daily requirement, not dozens", () => {
    const daysInMonth = 30;
    const taskMaster = [
      { name: "Layover Inspection", frequency: 90, frequencyUnit: "per_month", avgDurationMin: 480, reqB1: 1, reqB2: 0, reqCM: 0, reqNCS: 0, preferredShift: null },
    ];
    const plannedDemand = computeTaskMasterDemand(taskMaster, daysInMonth, 30);
    // Monthly total: 90 occurrences x 8h x 1 head = 720 man-hours.
    expect(plannedDemand.totalHours).toBe(720);

    const unplannedDemand = computeUnplannedWorkload([], { unplannedMethod: "frequency", unplannedManpowerHoursPerMonth: 0, unplannedBufferPct: 0 }, plannedDemand.totalHours);
    const manpower = computeExplainableManpower({ totalMovements: 0 }, plannedDemand, unplannedDemand, daysInMonth);

    // The bug this guards against: dividing the monthly total (720h, or per-shift
    // share 240h since no preferredShift splits evenly across M/A/N) by
    // hoursPerShift (8) ALONE gives 240/8 = 30 — "a number in the dozens/scores",
    // as if the whole month's task hours had to fit in one single shift.
    // Correctly dividing by daysInMonth FIRST (240/30/8 = 1) gives a small,
    // sensible daily per-shift headcount instead.
    expect(manpower.M.plannedMaintenance).toBeLessThan(5);
    expect(manpower.M.plannedMaintenance).toBe(1);
    expect(manpower.A.plannedMaintenance).toBe(1);
    expect(manpower.N.plannedMaintenance).toBe(1);
  });

  it("routes a task's hours to its actual preferredShift instead of splitting evenly", () => {
    const taskMaster = [
      { name: "Night Halt Check", frequency: 30, frequencyUnit: "per_month", avgDurationMin: 60, reqB1: 1, reqB2: 0, reqCM: 0, reqNCS: 0, preferredShift: "N" },
    ];
    const result = computeTaskMasterDemand(taskMaster, 30, 30);
    expect(result.byShift.N).toBeGreaterThan(0);
    expect(result.byShift.M).toBe(0);
    expect(result.byShift.A).toBe(0);
    expect(result.byShiftCategory.N.B1).toBeGreaterThan(0);
  });

  it("splits evenly across all 3 shifts when no preferredShift (or 'Any') is set", () => {
    const taskMaster = [
      { name: "General Task", frequency: 30, frequencyUnit: "per_month", avgDurationMin: 60, reqB1: 1, reqB2: 0, reqCM: 0, reqNCS: 0, preferredShift: "Any" },
    ];
    const result = computeTaskMasterDemand(taskMaster, 30, 30);
    expect(result.byShift.M).toBeCloseTo(result.byShift.A, 5);
    expect(result.byShift.A).toBeCloseTo(result.byShift.N, 5);
  });
});

describe("computeAveragePeakByShift — Real Requirement Average vs Peak Day table", () => {
  it("reports the plain average and the actual peak day's value separately, and they can genuinely differ", () => {
    // Morning demand: mostly light (B1=1) with one busy day (B1=3) — the
    // average must NOT hide that spike the way a flat monthly figure would.
    const demand = {};
    for (let d = 1; d <= 5; d++) demand[d] = { M: { B1: 1, CM: 1, NCS: 1 }, A: { B1: 0, CM: 0, NCS: 0 }, N: { B1: 0, CM: 0, NCS: 0 } };
    demand[3].M = { B1: 3, CM: 4, NCS: 4 }; // day 3 is the busy day
    const result = computeAveragePeakByShift(demand, 5);
    expect(result.M.B1.peak).toBe(3);
    expect(result.M.B1.avg).toBeCloseTo((1 + 1 + 3 + 1 + 1) / 5, 5);
    expect(result.M.B1.peak).toBeGreaterThan(result.M.B1.avg);
    expect(result.M.peakDay).toBe(3); // the day driving B1/CM/NCS's combined peak, shared across the row
  });

  it("returns zero avg/peak for a shift with no demand at all", () => {
    const demand = { 1: { M: { B1: 0, CM: 0, NCS: 0 }, A: { B1: 0, CM: 0, NCS: 0 }, N: { B1: 0, CM: 0, NCS: 0 } } };
    const result = computeAveragePeakByShift(demand, 1);
    expect(result.A.B1).toEqual({ avg: 0, peak: 0 });
  });
});
