const {
  generateTasksFromFlightInstance, checkEligibility, scoreCandidate, detectConflicts, DEFAULT_WEIGHTS,
} = require("../src/utils/taskAllocationEngine");

function flight(overrides = {}) {
  return {
    id: "fi1", flightNumber: "6E1234", aircraftRegistration: "VT-XAA", aircraftType: "B737-8",
    std: "2026-10-02T21:00:00.000Z", sta: null, stand: "12", terminal: "1", isTransit: true,
    ...overrides,
  };
}
function rule(overrides = {}) {
  return {
    id: "r1", isEnabled: true, onlyTransit: false, appliesTo: "DEPARTURE", taskType: "TRANSIT",
    startOffsetMin: -60, latestStartOffsetMin: -50, deadlineOffsetMin: -15, durationMin: 45,
    requiredRole: null, requiredCategory: "B1", requiredAircraftType: "B737", requiredAuthorization: null,
    teamSize: 1, priority: 2, taskDescription: null,
    ...overrides,
  };
}

describe("taskAllocationEngine.generateTasksFromFlightInstance", () => {
  it("generates a task anchored to STD with the rule's offsets applied", () => {
    const tasks = generateTasksFromFlightInstance(flight(), [rule()]);
    expect(tasks).toHaveLength(1);
    const t = tasks[0];
    expect(t.plannedStart.toISOString()).toBe("2026-10-02T20:00:00.000Z"); // STD - 60min
    expect(t.latestStart.toISOString()).toBe("2026-10-02T20:10:00.000Z"); // STD - 50min
    expect(t.deadline.toISOString()).toBe("2026-10-02T20:45:00.000Z"); // STD - 15min
    expect(t.estimatedDurationMin).toBe(45);
    expect(t.requiredCategory).toBe("B1");
    expect(t.stand).toBe("12");
    expect(t.source).toBe("AUTO_GENERATED");
    expect(t.status).toBe("UNASSIGNED");
  });

  it("skips a disabled rule entirely", () => {
    expect(generateTasksFromFlightInstance(flight(), [rule({ isEnabled: false })])).toHaveLength(0);
  });

  it("skips an onlyTransit rule for a non-transit flight instance", () => {
    const f = flight({ isTransit: false });
    expect(generateTasksFromFlightInstance(f, [rule({ onlyTransit: true })])).toHaveLength(0);
  });

  it("generates one task per matching anchor when the flight has both an arrival and a departure", () => {
    const f = flight({ sta: "2026-10-02T19:00:00.000Z", std: "2026-10-02T21:00:00.000Z" });
    const rules = [rule({ appliesTo: "BOTH", taskType: "PDC" })];
    const tasks = generateTasksFromFlightInstance(f, rules);
    expect(tasks).toHaveLength(2);
  });

  it("generates nothing for a rule whose appliesTo doesn't match any anchor present on the flight", () => {
    const f = flight({ std: null, sta: "2026-10-02T19:00:00.000Z" }); // no STD at all
    expect(generateTasksFromFlightInstance(f, [rule({ appliesTo: "DEPARTURE" })])).toHaveLength(0);
  });
});

describe("taskAllocationEngine.checkEligibility — hard constraints never compensated by a score", () => {
  function task(overrides = {}) {
    return {
      plannedStart: "2026-10-02T20:00:00.000Z", latestStart: "2026-10-02T20:10:00.000Z",
      deadline: "2026-10-02T20:45:00.000Z", estimatedDurationMin: 30,
      requiredCategory: "B1", requiredAircraftType: "B737", requiredAuthorization: null,
      location: "Stand 12", aircraftRegistration: "VT-XAA",
      ...overrides,
    };
  }
  function candidate(overrides = {}) {
    return {
      isActive: true, isRostered: true, onLeave: false, trainingPending: false, unavailable: false,
      category: "B1", secondaryCategories: [],
      qualCodes: ["B737 B1"], authorizationScopes: [],
      shiftStart: "2026-10-02T18:00:00.000Z", shiftEnd: "2026-10-03T02:00:00.000Z",
      existingAssignments: [],
      ...overrides,
    };
  }

  it("is eligible when every hard constraint passes", () => {
    const result = checkEligibility(task(), candidate());
    expect(result.eligible).toBe(true);
    expect(result.failedReasons).toHaveLength(0);
    expect(result.checklist.every(c => c.passed)).toBe(true);
  });

  it("fails on leave, regardless of everything else being fine", () => {
    const result = checkEligibility(task(), candidate({ onLeave: true }));
    expect(result.eligible).toBe(false);
    expect(result.failedReasons).toContain("Not on leave");
  });

  it("fails training-pending even though the person is otherwise qualified", () => {
    const result = checkEligibility(task(), candidate({ trainingPending: true }));
    expect(result.eligible).toBe(false);
    expect(result.failedReasons).toContain("Not unavailable due to training/absence");
  });

  it("fails when the candidate lacks the required aircraft qualification", () => {
    const result = checkEligibility(task(), candidate({ qualCodes: ["A320 B1"] }));
    expect(result.eligible).toBe(false);
    expect(result.failedReasons).toContain("Required aircraft qualification");
  });

  it("passes category via a secondary qualification, not just the primary category", () => {
    const result = checkEligibility(task({ requiredCategory: "CM" }), candidate({ category: "B1", secondaryCategories: ["CM"] }));
    expect(result.eligible).toBe(true);
  });

  it("fails when the required category isn't primary or secondary", () => {
    const result = checkEligibility(task({ requiredCategory: "CM" }), candidate({ category: "B1", secondaryCategories: [] }));
    expect(result.eligible).toBe(false);
    expect(result.failedReasons).toContain("Required role/category");
  });

  it("fails when the task window falls outside the candidate's rostered shift", () => {
    const c = candidate({ shiftStart: "2026-10-02T06:00:00.000Z", shiftEnd: "2026-10-02T14:00:00.000Z" }); // Morning shift, task is at 20:00
    const result = checkEligibility(task(), c);
    expect(result.eligible).toBe(false);
    expect(result.failedReasons).toContain("Available at task start (within rostered shift)");
  });

  it("fails on an impossible overlapping task", () => {
    const c = candidate({
      existingAssignments: [{ taskId: "other", plannedStart: "2026-10-02T19:50:00.000Z", taskEnd: "2026-10-02T20:30:00.000Z", location: "Stand 5" }],
    });
    const result = checkEligibility(task(), c);
    expect(result.eligible).toBe(false);
    expect(result.failedReasons).toContain("No impossible overlapping task");
  });

  it("fails when travel time from the previous task is insufficient", () => {
    const c = candidate({
      existingAssignments: [{ taskId: "prev", plannedStart: "2026-10-02T19:00:00.000Z", taskEnd: "2026-10-02T19:55:00.000Z", location: "Hangar" }],
      travelTimeLookup: (from, to) => (from === "Hangar" && to === "Stand 12" ? 15 : null), // needs 15, only has 5
    });
    const result = checkEligibility(task(), c);
    expect(result.eligible).toBe(false);
    expect(result.failedReasons).toContain("Travel time feasible");
  });

  it("passes when travel time from the previous task is sufficient", () => {
    const c = candidate({
      existingAssignments: [{ taskId: "prev", plannedStart: "2026-10-02T19:00:00.000Z", taskEnd: "2026-10-02T19:40:00.000Z", location: "Hangar" }],
      travelTimeLookup: (from, to) => (from === "Hangar" && to === "Stand 12" ? 15 : null), // needs 15, has 20
    });
    const result = checkEligibility(task(), c);
    expect(result.eligible).toBe(true);
  });

  it("does not block on an unconfigured travel-time pair (null lookup result)", () => {
    const c = candidate({
      existingAssignments: [{ taskId: "prev", plannedStart: "2026-10-02T19:00:00.000Z", taskEnd: "2026-10-02T19:59:00.000Z", location: "Unknown Spot" }],
      travelTimeLookup: () => null,
    });
    const result = checkEligibility(task(), c);
    expect(result.eligible).toBe(true);
  });

  it("fails when the task cannot complete before its deadline", () => {
    const result = checkEligibility(task({ estimatedDurationMin: 60 }), candidate()); // 20:00 + 60min = 21:00, deadline is 20:45
    expect(result.eligible).toBe(false);
    expect(result.failedReasons).toContain("Deadline achievable");
  });
});

describe("taskAllocationEngine.scoreCandidate — deterministic, reproducible", () => {
  const baseTask = {
    plannedStart: "2026-10-02T20:00:00.000Z", deadline: "2026-10-02T20:45:00.000Z", aircraftRegistration: "VT-XAA", location: "Stand 12",
  };

  it("produces the identical score for identical inputs (deterministic, no randomness)", () => {
    const candidate = { currentWorkloadMinutes: 100, existingAssignments: [] };
    const a = scoreCandidate(baseTask, candidate, DEFAULT_WEIGHTS);
    const b = scoreCandidate(baseTask, candidate, DEFAULT_WEIGHTS);
    expect(a).toEqual(b);
  });

  it("scores a less-loaded candidate higher than a more-loaded one, all else equal", () => {
    const light = scoreCandidate(baseTask, { currentWorkloadMinutes: 0, existingAssignments: [] });
    const heavy = scoreCandidate(baseTask, { currentWorkloadMinutes: 400, existingAssignments: [] });
    expect(light.score).toBeGreaterThan(heavy.score);
  });

  it("scores a candidate already on the SAME aircraft higher (task continuity)", () => {
    const sameTail = scoreCandidate(baseTask, { existingAssignments: [{ aircraftRegistration: "VT-XAA", taskEnd: "2026-10-02T19:00:00.000Z" }] });
    const differentTail = scoreCandidate(baseTask, { existingAssignments: [{ aircraftRegistration: "VT-XBB", taskEnd: "2026-10-02T19:00:00.000Z" }] });
    expect(sameTail.score).toBeGreaterThan(differentTail.score);
  });

  it("never scores task continuity as a match when the task has no registration set (synced from Flight Schedule, pre-edit)", () => {
    // A Flight Instance synced from the Turn Report carries no registration
    // until someone fills it in by hand — task.aircraftRegistration and an
    // existing assignment's aircraftRegistration can both legitimately be
    // null at once, and `null === null` must never read as "same tail."
    const noTailTask = { ...baseTask, aircraftRegistration: null };
    const withNullAssignment = scoreCandidate(noTailTask, { existingAssignments: [{ aircraftRegistration: null, taskEnd: "2026-10-02T19:00:00.000Z" }] });
    const withNoAssignments = scoreCandidate(noTailTask, { existingAssignments: [] });
    expect(withNullAssignment.breakdown.taskContinuity).toBe(withNoAssignments.breakdown.taskContinuity);
  });

  it("weighted components sum to the overall score", () => {
    const { score, breakdown } = scoreCandidate(baseTask, { currentWorkloadMinutes: 50, existingAssignments: [] });
    const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 10) / 10).toBeCloseTo(score, 1);
  });
});

describe("taskAllocationEngine.detectConflicts", () => {
  it("flags a genuine employee overlap between two assigned tasks", () => {
    const conflicts = detectConflicts({
      tasks: [],
      assignmentsByUser: {
        u1: [
          { taskId: "t1", plannedStart: "2026-10-02T20:00:00.000Z", taskEnd: "2026-10-02T20:45:00.000Z", location: "Stand 1" },
          { taskId: "t2", plannedStart: "2026-10-02T20:30:00.000Z", taskEnd: "2026-10-02T21:30:00.000Z", location: "Stand 2" },
        ],
      },
    });
    const overlap = conflicts.find(c => c.conflictType === "EMPLOYEE_OVERLAP");
    expect(overlap).toBeDefined();
    expect(overlap.details.overlapMinutes).toBe(15);
  });

  it("flags insufficient travel time between two back-to-back tasks", () => {
    const conflicts = detectConflicts({
      tasks: [],
      assignmentsByUser: {
        u1: [
          { taskId: "t1", plannedStart: "2026-10-02T20:00:00.000Z", taskEnd: "2026-10-02T20:45:00.000Z", location: "Stand 4" },
          { taskId: "t2", plannedStart: "2026-10-02T20:50:00.000Z", taskEnd: "2026-10-02T21:30:00.000Z", location: "Stand 18" }, // only 5min gap
        ],
      },
      travelTimeLookup: (from, to) => (from === "Stand 4" && to === "Stand 18" ? 12 : null),
    });
    const travel = conflicts.find(c => c.conflictType === "LOCATION_TRAVEL");
    expect(travel).toBeDefined();
    expect(travel.details.neededMinutes).toBe(12);
    expect(travel.details.availableMinutes).toBe(5);
  });

  it("flags a task that cannot complete before its own deadline", () => {
    const conflicts = detectConflicts({
      tasks: [{ id: "t1", status: "ASSIGNED", plannedStart: "2026-10-02T20:00:00.000Z", estimatedDurationMin: 60, deadline: "2026-10-02T20:45:00.000Z" }],
      assignmentsByUser: {},
    });
    expect(conflicts.some(c => c.conflictType === "DEADLINE" && c.taskId === "t1")).toBe(true);
  });

  it("flags a resource shortage against configured demand", () => {
    const conflicts = detectConflicts({
      tasks: [], assignmentsByUser: {},
      demandByCategoryShift: { "B1|N": 3 },
      availableByCategoryShift: { "B1|N": 2 },
    });
    const shortage = conflicts.find(c => c.conflictType === "RESOURCE_SHORTAGE");
    expect(shortage).toBeDefined();
    expect(shortage.details).toEqual({ category: "B1", shift: "N", required: 3, available: 2, shortage: 1 });
  });

  it("reports nothing when there's genuinely no conflict", () => {
    const conflicts = detectConflicts({
      tasks: [{ id: "t1", status: "ASSIGNED", plannedStart: "2026-10-02T20:00:00.000Z", estimatedDurationMin: 30, deadline: "2026-10-02T20:45:00.000Z" }],
      assignmentsByUser: { u1: [{ taskId: "t1", plannedStart: "2026-10-02T20:00:00.000Z", taskEnd: "2026-10-02T20:30:00.000Z", location: "Stand 1" }] },
      demandByCategoryShift: { "B1|M": 1 }, availableByCategoryShift: { "B1|M": 2 },
    });
    expect(conflicts).toHaveLength(0);
  });
});
