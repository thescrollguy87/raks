const {
  findPeakConcurrency, computeDailyShiftDemand, computeTaskMasterDemand,
  computeExplainableManpower, computeUnplannedWorkload, computeAveragePeakByShift,
  buildPDCWorkloadEvents, buildTransitWorkloadEvents, computeDailyPeaks, computeExpectedManhours,
} = require("../src/utils/workloadEngine");
const { decodeDaysOfWeek } = require("../src/utils/flightScheduleParser");

const DEFAULT_CONFIG = {
  transitMinutesDefault: 40, pdcMinutesBeforeDeparture: 60, clashProximityMinutes: 60,
  transitVsPdcThresholdMinutes: 120, movementsPerB1Staff: 4, movementsPerCMStaff: 1, movementsPerNCSStaff: 1,
  unplannedMethod: "frequency", unplannedBufferPct: 20,
  unplannedHoursB1: 0, unplannedHoursB2: 0, unplannedHoursCM: 0, unplannedHoursNCS: 0,
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

  it("NCS's own Mandatory Minimum floor is reflected in the demand, not just enforced separately at generation time", () => {
    // No flight schedule at all for Night — pure base-coverage fallback
    // path. Previously NCS ignored ncsBaseCoverage entirely here (only
    // manual demand + buffer), so a station with e.g. a Night floor of 4
    // would see the demand/Category-Requirement display show 0 even
    // though buildRosterAssignments's separate mandatory-tier fill loop
    // was already guaranteeing 4 NCS on the actual generated roster —
    // display and generation silently disagreeing.
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 0, N: 0 },
      ncsBaseCoverage: { M: 0, A: 0, N: 4 },
      flightSchedule: null, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    expect(result.demand[1].N.NCS).toBe(4);
    expect(result.demand[1].M.NCS).toBe(0); // floor only applies to the shift it's configured for
  });

  it("NCS's floor also applies on the flight-schedule-driven path, taking the max with concurrency/clash", () => {
    const turn1 = quickTurn("09:00", "09:05");
    const turn2 = quickTurn("09:30", "09:35"); // 2-way clash, same as earlier tests -> concurrency-driven NCS would be 2
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 0, N: 0 },
      ncsBaseCoverage: { M: 0, A: 5, N: 0 }, // floor (5) deliberately higher than the clash-driven count (2)
      flightSchedule: { turnRecords: [turn1, turn2], charterRecords: [] }, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    expect(result.demand[1].A.NCS).toBe(5); // floor wins over the lower concurrency/clash-driven count
  });

  it("CM's own Mandatory Minimum floor is reflected in the demand, not just B1's leftover pooling", () => {
    // No flight schedule at all — pure base-coverage fallback path. CM's
    // demand previously came ONLY from concurrency left over after B1's
    // floor capacity (see the B1/CM pooling above), so a station that set
    // e.g. a Night floor of 2 directly on CM (independent of any B1
    // pooling) would see the demand/Category-Requirement display show 0
    // whenever there was no flight-driven concurrency at that shift.
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 0, N: 0 },
      cmBaseCoverage: { M: 0, A: 0, N: 2 },
      flightSchedule: null, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    expect(result.demand[1].N.CM).toBe(2);
    expect(result.demand[1].M.CM).toBe(0); // floor only applies to the shift it's configured for
  });

  it("CM's floor also applies on the flight-schedule-driven path, taking the max with the B1-pooling result", () => {
    const turn1 = quickTurn("09:00", "09:05");
    const turn2 = quickTurn("09:30", "09:35"); // 2-way clash -> concurrency-driven CM (after B1 pooling) would be 1
    const config = { ...DEFAULT_CONFIG, movementsPerB1Staff: 1, movementsPerCMStaff: 1 };
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 1, N: 0 },
      cmBaseCoverage: { M: 0, A: 5, N: 0 }, // floor (5) deliberately higher than the pooled concurrency-driven count
      flightSchedule: { turnRecords: [turn1, turn2], charterRecords: [] }, config,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    expect(result.demand[1].A.CM).toBe(5); // floor wins over the lower concurrency/clash-driven count
  });

  it("Planned/Unplanned Task Master workload (layover, weekly check, wheel change, etc.) feeds actual demand, not just the display", () => {
    // Previously computeTaskMasterDemand/computeUnplannedWorkload's output
    // fed only the Workload Summary / Explainable Manpower display panels —
    // never the actual demand generation fills against — so a station with
    // real recurring task-master workload could see it reflected on screen
    // and still have Auto Generate roster as if none of it existed.
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 0, N: 0 },
      taskMasterByShiftCategory: { M: { B1: 0, B2: 0, CM: 3, NCS: 0 }, A: { B1: 0, B2: 0, CM: 0, NCS: 0 }, N: { B1: 0, B2: 0, CM: 0, NCS: 0 } },
      flightSchedule: null, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    expect(result.demand[1].M.CM).toBe(3);
    expect(result.demand[1].A.CM).toBe(0); // only applies to the shift it's attributed to
  });

  it("Task Master demand takes the MAX with the Mandatory Minimum floor, never summed on top of it", () => {
    // Real feedback: the Mandatory Minimum floor is meant to already
    // represent "enough for a typical shift including our normal recurring
    // workload" — a station that set NCS Night's floor to 4 did not mean
    // "4, plus however many more Task Master's own math comes up with." A
    // floor of 4 with 2h/day of averaged Task Master workload (well under
    // one extra head) must stay at 4, not become 6.
    const small = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 0, N: 0 },
      ncsBaseCoverage: { M: 0, A: 0, N: 4 },
      taskMasterByShiftCategory: { M: { B1: 0, B2: 0, CM: 0, NCS: 0 }, A: { B1: 0, B2: 0, CM: 0, NCS: 0 }, N: { B1: 0, B2: 0, CM: 0, NCS: 2 } },
      flightSchedule: null, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    expect(small.demand[1].N.NCS).toBe(4); // floor wins — task master's 2 doesn't add on top

    // And when Task Master's own workload genuinely exceeds the floor, IT
    // wins instead (still not summed with the floor).
    const large = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 0, N: 0 },
      ncsBaseCoverage: { M: 0, A: 0, N: 4 },
      taskMasterByShiftCategory: { M: { B1: 0, B2: 0, CM: 0, NCS: 0 }, A: { B1: 0, B2: 0, CM: 0, NCS: 0 }, N: { B1: 0, B2: 0, CM: 0, NCS: 7 } },
      flightSchedule: null, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    expect(large.demand[1].N.NCS).toBe(7); // task master's 7 wins over the floor of 4 — still not 11
  });

  it("Task Master workload also takes the MAX with the floor on the flight-schedule-driven path, adding nothing extra when the floor already wins", () => {
    const turn1 = quickTurn("09:00", "09:05");
    const result = computeDailyShiftDemand({
      year: 2026, month: 9, homeStation: "AMD", baseCoverage: { M: 0, A: 5, N: 0 }, // B1 floor 5 on Afternoon
      taskMasterByShiftCategory: { M: { B1: 0, B2: 0, CM: 0, NCS: 0 }, A: { B1: 2, B2: 0, CM: 0, NCS: 0 }, N: { B1: 0, B2: 0, CM: 0, NCS: 0 } },
      flightSchedule: { turnRecords: [turn1], charterRecords: [] }, config: DEFAULT_CONFIG,
      manualDemandEntries: [], shiftDefs: SHIFT_DEFS, perShiftBuffer: { B1: 0, B2: 0, CM: 0, NCS: 0 },
    });
    // The floor (5) already exceeds task master's 2, so B1's Afternoon
    // figure is exactly the floor — never 7.
    expect(result.demand[1].A.B1).toBe(5);
  });

  it("computeUnplannedWorkload routes each task's hours to its own Preferred Shift instead of spreading everything evenly", () => {
    // Previously the caller had no per-shift breakdown for unplanned tasks
    // at all and had to spread the whole monthly total evenly across M/A/N
    // regardless of each task's actual Preferred Shift — e.g. Wheel Change
    // and Troubleshooting set to Night would incorrectly leak hours onto
    // Morning/Afternoon too, while genuinely diluting Night's real figure.
    const unplannedTaskMaster = [
      { name: "Wheel Change", avgFreqPerMonth: 25, avgDurationMin: 45, reqCM: 1, reqNCS: 1, preferredShift: "N" },
      { name: "AOG Rectification", avgFreqPerMonth: 2, avgDurationMin: 360, reqB1: 1, reqNCS: 2, preferredShift: null }, // "Any" -> split evenly
    ];
    const config = { unplannedMethod: "frequency", unplannedBufferPct: 0 };
    const result = computeUnplannedWorkload(unplannedTaskMaster, config, { B1: 0, B2: 0, CM: 0, NCS: 0 });
    // Wheel Change: 25 * 0.75h * 1 NCS = 18.75h, all on Night.
    // AOG Rectification: 2 * 6h * 2 NCS = 24h, split evenly -> 8h per shift.
    expect(result.byShiftCategory.N.NCS).toBeCloseTo(18.75 + 8, 5);
    expect(result.byShiftCategory.M.NCS).toBeCloseTo(8, 5);
    expect(result.byShiftCategory.A.NCS).toBeCloseTo(8, 5);
    expect(result.byShiftCategory.N.CM).toBeCloseTo(25 * 0.75, 5); // Wheel Change's CM share, Night only
  });

  it("wires the flat Manpower-Hours Allowance into byCategory/byShiftCategory, per category, not just the combined total (Issue #6)", () => {
    // Previously unplannedManpowerHoursPerMonth was a single combined
    // number added only to `hours` — never to byCategory/byShiftCategory —
    // so it showed up on the Workload Summary panel but fed ZERO actual
    // demand, since computeDailyShiftDemand needs a per-category, per-shift
    // figure. Now each category has its own monthly allowance, spread
    // evenly across the month's 3 shifts like an "Any"-shift task.
    const config = {
      unplannedMethod: "manpower_hours", unplannedBufferPct: 0,
      unplannedHoursB1: 30, unplannedHoursCM: 15, unplannedHoursB2: 0, unplannedHoursNCS: 0,
    };
    const result = computeUnplannedWorkload([], config, { B1: 0, B2: 0, CM: 0, NCS: 0 });
    expect(result.byCategory.B1).toBe(30);
    expect(result.byCategory.CM).toBe(15);
    expect(result.byCategory.B2).toBe(0);
    expect(result.fromTasksOrAllowance).toBe(45);
    // Spread evenly across M/A/N: 30/3 = 10 per shift.
    expect(result.byShiftCategory.M.B1).toBeCloseTo(10, 5);
    expect(result.byShiftCategory.A.B1).toBeCloseTo(10, 5);
    expect(result.byShiftCategory.N.B1).toBeCloseTo(10, 5);
    expect(result.byShiftCategory.N.CM).toBeCloseTo(5, 5);
  });

  it("wires the buffer % into byCategory/byShiftCategory, scaled to each category's OWN planned hours (Issue #6)", () => {
    // Previously bufferHours was a single combined number (plannedTotalHours
    // * pct%) added only to the overall total — never distributed per
    // category — so a category with zero planned work still looked
    // unaffected, but the buffer itself never reached actual demand either.
    const plannedByCategory = { B1: 100, B2: 0, CM: 50, NCS: 0 };
    const config = { unplannedMethod: "frequency", unplannedBufferPct: 20 };
    const result = computeUnplannedWorkload([], config, plannedByCategory);
    expect(result.bufferHours).toBe(30); // 20% of (100+50) = 30
    expect(result.byCategory.B1).toBe(20); // 20% of B1's own 100
    expect(result.byCategory.CM).toBe(10); // 20% of CM's own 50
    expect(result.byCategory.B2).toBe(0); // B2 had zero planned hours -> zero buffer
    expect(result.byShiftCategory.M.B1).toBeCloseTo(20 / 3, 5);
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

    const unplannedDemand = computeUnplannedWorkload([], { unplannedMethod: "frequency", unplannedBufferPct: 0 }, plannedDemand.byCategory);
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

describe("buildPDCWorkloadEvents — overnight date handling", () => {
  it("shifts the event to the day AFTER arrival when the outbound departure wraps past midnight", () => {
    // Aircraft arrives 23:00, long ground time, departs 06:00 the NEXT
    // calendar day for an overnight PDC job — same wrap Transit events
    // already detect by comparing arrival vs. departure minutes-of-day.
    const turn = {
      inboundFlt: "IN", outboundFlt: "OUT", outboundDepSta: "AMD", inboundArrSta: "AMD",
      inboundArrMin: 23 * 60, outboundDepMin: 6 * 60, groundTimeMin: 420, // 7h ground time, well above the PDC threshold
      effectiveDate: new Date(2026, 8, 5), discontinueDate: new Date(2026, 8, 5),
      daysOfWeek: decodeDaysOfWeek(1234567),
    };
    const events = buildPDCWorkloadEvents([turn], [], 2026, 9, "AMD", DEFAULT_CONFIG);
    expect(events).toHaveLength(1);
    // The event's date must be Sep 6 (the real departure day), not Sep 5
    // (the arrival day expandOperatingDates anchors to) — otherwise the
    // PDC workload is misfiled into the wrong day's peak-concurrency bucket.
    expect(events[0].date.toISOString().slice(0, 10)).toBe("2026-09-06");
    // Its absolute end time must likewise land on Sep 6 06:00, not Sep 5.
    const expectedEnd = Math.floor(new Date(2026, 8, 6).getTime() / 60000) + 6 * 60;
    expect(events[0].end).toBe(expectedEnd);
  });

  it("keeps the same-day date when the outbound departure does not wrap past midnight", () => {
    const turn = {
      inboundFlt: "IN", outboundFlt: "OUT", outboundDepSta: "AMD", inboundArrSta: "AMD",
      inboundArrMin: 8 * 60, outboundDepMin: 11 * 60, groundTimeMin: 180,
      effectiveDate: new Date(2026, 8, 5), discontinueDate: new Date(2026, 8, 5),
      daysOfWeek: decodeDaysOfWeek(1234567),
    };
    const events = buildPDCWorkloadEvents([turn], [], 2026, 9, "AMD", DEFAULT_CONFIG);
    expect(events[0].date.toISOString().slice(0, 10)).toBe("2026-09-05");
  });

  it("leaves a PDC turn with no matching inbound arrival (null inboundArrMin) anchored to its own operating date", () => {
    const turn = {
      inboundFlt: null, outboundFlt: "OUT", outboundDepSta: "AMD", inboundArrSta: null,
      inboundArrMin: null, outboundDepMin: 2 * 60, groundTimeMin: null,
      effectiveDate: new Date(2026, 8, 5), discontinueDate: new Date(2026, 8, 5),
      daysOfWeek: decodeDaysOfWeek(1234567),
    };
    const events = buildPDCWorkloadEvents([turn], [], 2026, 9, "AMD", DEFAULT_CONFIG);
    expect(events[0].date.toISOString().slice(0, 10)).toBe("2026-09-05");
  });
});

describe("computeDailyPeaks — day bucketing stays correct regardless of server timezone", () => {
  // computeDailyPeaks groups events by e.date, which is built with the
  // LOCAL Date constructor (via expandOperatingDates) — bucketing it with
  // .toISOString() (always UTC) used to silently misfile the event into
  // the PREVIOUS calendar day whenever the server's TZ sits east of UTC
  // (IST, UTC+5:30, included). Proven by actually switching process.env.TZ
  // at runtime, restored afterward so it can't leak into sibling test files.
  const originalTZ = process.env.TZ;
  afterEach(() => { process.env.TZ = originalTZ; });

  it("buckets a transit event into the correct day under an Asia/Kolkata server timezone", () => {
    process.env.TZ = "Asia/Kolkata";
    const turn = quickTurn("09:00", "09:40");
    turn.effectiveDate = new Date(2026, 8, 20);
    turn.discontinueDate = new Date(2026, 8, 20);
    const events = buildTransitWorkloadEvents([turn], 2026, 9, "AMD", DEFAULT_CONFIG);
    const peaks = computeDailyPeaks(events);
    expect(peaks.perDay.map(d => d.date)).toEqual(["2026-09-20"]);
    expect(peaks.monthPeakDay.date).toBe("2026-09-20");
  });
});

describe("computeExpectedManhours — advisoryDemand headcount converted to real man-hours", () => {
  it("multiplies each shift's headcount target by that shift's real duration and sums per category", () => {
    const advisoryDemand = {
      1: { M: { B1: 1, B2: 0, CM: 2, NCS: 3 }, A: { B1: 1, B2: 0, CM: 0, NCS: 1 }, N: { B1: 0, B2: 1, CM: 2, NCS: 4 } },
      2: { M: { B1: 1, B2: 0, CM: 0, NCS: 3 }, A: { B1: 0, B2: 0, CM: 0, NCS: 0 }, N: { B1: 0, B2: 1, CM: 2, NCS: 4 } },
    };
    const shiftHoursByFamily = { M: 8, A: 8, N: 10 }; // Night deliberately longer, to prove it's not a flat 8h assumption
    const result = computeExpectedManhours(advisoryDemand, 2, shiftHoursByFamily);
    // CM: day1 (M:2*8=16, N:2*10=20) + day2 (N:2*10=20) = 56
    expect(result.byCategory.CM).toBe(56);
    // NCS: day1 (M:3*8=24, A:1*8=8, N:4*10=40) + day2 (M:3*8=24, N:4*10=40) = 136
    expect(result.byCategory.NCS).toBe(136);
    expect(result.total).toBe(result.byCategory.B1 + result.byCategory.B2 + result.byCategory.CM + result.byCategory.NCS);
  });

  it("returns all zeros for a month with no demand at all", () => {
    const result = computeExpectedManhours({}, 5, { M: 8, A: 8, N: 10 });
    expect(result.total).toBe(0);
    expect(result.byCategory).toEqual({ B1: 0, B2: 0, CM: 0, NCS: 0 });
  });
});
