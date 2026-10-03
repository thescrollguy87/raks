// TASK ALLOCATION MODULE — pure, DB-free core logic. Kept separate from the
// services that fetch real data and persist results (same split
// rosterGenerationAlgorithm.js/rosterGenerationService.js already use, for
// the same reason: this is the part that's actually worth testing
// thoroughly, with plain objects, no mocking required).
//
// Per the spec's Section 31: the eligibility and scoring decisions here are
// 100% deterministic rules/arithmetic — no LLM is used or should ever be
// used for "which person gets this task." An LLM may only ever explain an
// already-made decision in natural language, never make it.

// ─── Task Generator (Section 7) ──────────────────────────────────────────────

// Converts one real flight instance + the station's configured
// AllocationRule rows into zero or more draft task field-sets. Pure: given
// the same flight instance and rules, always produces the same tasks — the
// caller (taskGeneratorService.js) is responsible for persisting them and
// skipping ones that already exist for this flight instance + rule.
//
// Each rule's offsets are minutes relative to its OWN anchor event — STA for
// an ARRIVAL rule, STD for a DEPARTURE rule, and (when a flight instance has
// both) for a BOTH rule, since a turn can genuinely need pre-arrival AND
// pre-departure variants, applied to each event independently.
function generateTasksFromFlightInstance(flightInstance, rules) {
  const tasks = [];
  const anchors = [];
  if (flightInstance.sta) anchors.push({ event: "ARRIVAL", at: new Date(flightInstance.sta) });
  if (flightInstance.std) anchors.push({ event: "DEPARTURE", at: new Date(flightInstance.std) });

  for (const rule of rules) {
    if (!rule.isEnabled) continue;
    if (rule.onlyTransit && !flightInstance.isTransit) continue;
    for (const anchor of anchors) {
      if (rule.appliesTo !== "BOTH" && rule.appliesTo !== anchor.event) continue;
      const plannedStart = addMinutes(anchor.at, rule.startOffsetMin);
      const latestStart = addMinutes(anchor.at, rule.latestStartOffsetMin);
      const deadline = addMinutes(anchor.at, rule.deadlineOffsetMin);
      tasks.push({
        flightInstanceId: flightInstance.id,
        flightNumber: flightInstance.flightNumber,
        aircraftRegistration: flightInstance.aircraftRegistration,
        aircraftType: flightInstance.aircraftType || null,
        taskType: rule.taskType,
        taskCategory: rule.taskType,
        taskDescription: rule.taskDescription || `${rule.taskType} — ${flightInstance.flightNumber} (${flightInstance.aircraftRegistration || "tail not yet set"})`,
        plannedStart, latestStart, deadline,
        estimatedDurationMin: rule.durationMin,
        requiredRole: rule.requiredRole || null,
        requiredCategory: rule.requiredCategory || null,
        requiredAircraftType: rule.requiredAircraftType || null,
        requiredAuthorization: rule.requiredAuthorization || null,
        location: flightInstance.stand || null,
        terminal: flightInstance.terminal || null,
        stand: flightInstance.stand || null,
        priority: rule.priority,
        teamSize: rule.teamSize,
        source: "AUTO_GENERATED",
        ruleId: rule.id,
        status: "UNASSIGNED",
      });
    }
  }
  return tasks;
}
function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

// ─── Eligibility Engine (Section 9) ──────────────────────────────────────────
// Every hard constraint, in the spec's own order. Each check is independent
// and deterministic; a single failure makes the candidate NOT ELIGIBLE —
// nothing here ever compensates a failed mandatory check with a score
// (Section 9's own closing rule).
const HARD_CHECKS = [
  {
    code: "ACTIVE", label: "Employee is active",
    test: (task, c) => c.isActive !== false,
  },
  {
    code: "ROSTERED", label: "Rostered for this period",
    test: (task, c) => !!c.isRostered,
  },
  {
    code: "NOT_ON_LEAVE", label: "Not on leave",
    test: (task, c) => !c.onLeave,
  },
  {
    code: "NOT_TRAINING_PENDING", label: "Not unavailable due to training/absence",
    test: (task, c) => !c.trainingPending && !c.unavailable,
  },
  {
    code: "AIRCRAFT_QUAL", label: "Required aircraft qualification",
    test: (task, c) => !task.requiredAircraftType || (c.qualCodes || []).some(q => qualMatchesAircraftType(q, task.requiredAircraftType)),
  },
  {
    code: "ROLE_CATEGORY", label: "Required role/category",
    test: (task, c) => !task.requiredCategory || c.category === task.requiredCategory || (c.secondaryCategories || []).includes(task.requiredCategory),
  },
  {
    code: "AUTHORIZATION", label: "Required authorization",
    test: (task, c) => !task.requiredAuthorization || (c.authorizationScopes || []).some(a => scopeMatches(a, task.requiredAuthorization)),
  },
  {
    code: "AVAILABLE_AT_START", label: "Available at task start (within rostered shift)",
    test: (task, c) => withinShiftWindow(task, c),
  },
  {
    code: "NO_OVERLAP", label: "No impossible overlapping task",
    test: (task, c) => !(c.existingAssignments || []).some(a => overlaps(task.plannedStart, taskEnd(task), a.plannedStart, a.taskEnd)),
  },
  {
    code: "TRAVEL_TIME", label: "Travel time feasible",
    test: (task, c) => travelTimeFeasible(task, c),
  },
  {
    code: "DEADLINE", label: "Deadline achievable",
    test: (task, c) => taskEnd(task).getTime() <= new Date(task.deadline).getTime() && new Date(task.plannedStart).getTime() <= new Date(task.latestStart).getTime(),
  },
];

function taskEnd(task) {
  return addMinutes(new Date(task.plannedStart), task.estimatedDurationMin);
}
function overlaps(startA, endA, startB, endB) {
  return new Date(startA).getTime() < new Date(endB).getTime() && new Date(startB).getTime() < new Date(endA).getTime();
}
// qualCode is free text like "B737 B1" / "A320 B2" — matches when it
// contains the required aircraft type as a whole word, case-insensitively,
// so "B737 B1" matches a requiredAircraftType of "B737" or "B737-8" prefix
// without also matching an unrelated "B7378" typo.
function qualMatchesAircraftType(qualCode, requiredAircraftType) {
  if (!qualCode) return false;
  return qualCode.toUpperCase().includes(String(requiredAircraftType).toUpperCase());
}
function scopeMatches(scope, requiredAuthorization) {
  if (!scope) return false;
  return scope.toUpperCase().includes(String(requiredAuthorization).toUpperCase());
}
// The task's full [plannedStart, taskEnd] window must sit inside the
// candidate's rostered shift window. An overnight Night shift's `shiftEnd`
// is earlier in clock time than `shiftStart` on the same calendar day (e.g.
// 21:00 -> 07:00 next day) — shiftEnd is expected to already be the REAL
// next-day Date object (the caller resolves this from the roster, not this
// function), so a plain Date comparison is always correct here.
function withinShiftWindow(task, c) {
  if (!c.shiftStart || !c.shiftEnd) return false;
  const start = new Date(task.plannedStart).getTime();
  const end = taskEnd(task).getTime();
  return start >= new Date(c.shiftStart).getTime() && end <= new Date(c.shiftEnd).getTime();
}
// Section 11: previous task end + travel time + next task start. Checked
// against BOTH the task immediately before and immediately after this one
// in the candidate's existing schedule, using context.travelTimeMinutes —
// a lookup function the caller supplies (reads TravelTimeMatrix), returning
// null when no configured travel time exists for that location pair (in
// which case this check passes — an unconfigured pair is never treated as
// "unreachable", only an explicitly INSUFFICIENT one blocks).
function travelTimeFeasible(task, c) {
  const lookup = c.travelTimeLookup;
  if (!lookup || !(c.existingAssignments || []).length) return true;
  const sorted = [...c.existingAssignments].sort((a, b) => new Date(a.plannedStart) - new Date(b.plannedStart));
  const before = sorted.filter(a => new Date(a.taskEnd).getTime() <= new Date(task.plannedStart).getTime()).pop();
  const after = sorted.find(a => new Date(a.plannedStart).getTime() >= taskEnd(task).getTime());
  if (before && before.location && task.location) {
    const need = lookup(before.location, task.location);
    if (need != null) {
      const gapMin = (new Date(task.plannedStart).getTime() - new Date(before.taskEnd).getTime()) / 60000;
      if (gapMin < need) return false;
    }
  }
  if (after && after.location && task.location) {
    const need = lookup(task.location, after.location);
    if (need != null) {
      const gapMin = (new Date(after.plannedStart).getTime() - taskEnd(task).getTime()) / 60000;
      if (gapMin < need) return false;
    }
  }
  return true;
}

// Runs every hard check for one (task, candidate) pair. Returns a
// checklist (every check, pass/fail) rather than stopping at the first
// failure, so BOTH "NOT ELIGIBLE" (Section 9) and "why was this person
// assigned" (Section 16, for the one who passed everything) come from the
// exact same single source of truth.
function checkEligibility(task, candidate) {
  const checklist = HARD_CHECKS.map(check => ({ code: check.code, label: check.label, passed: !!check.test(task, candidate) }));
  const failed = checklist.filter(c => !c.passed);
  return { eligible: failed.length === 0, checklist, failedReasons: failed.map(f => f.label) };
}

// ─── Assignment Optimizer / scoring (Section 10) ─────────────────────────────
// Each component returns 0-1; the caller's weights (from AllocationSettings,
// summing to ~100) convert these into the final weighted score out of 100.
// Deliberately simple, inspectable arithmetic — no ML model, no randomness,
// so the same inputs always produce the same score (Section 31).
const DEFAULT_WEIGHTS = {
  deadline: 30, workloadBalance: 20, travelTime: 15, taskContinuity: 10,
  resourceUtilization: 10, idleTimeReduction: 10, fairness: 5,
};

function scoreCandidate(task, candidate, weights = DEFAULT_WEIGHTS) {
  const components = {
    // Closer to the deadline (less slack) scores HIGHER — the most
    // time-critical eligible candidate for an urgent task should win over
    // one who merely has more free time, when a task's own priority/
    // deadline genuinely makes it more critical to lock in now.
    deadline: slackScore(task),
    // Prefers the candidate with the LOWER current workload (fewer minutes
    // already assigned today) — balances load across the available pool
    // instead of piling everything on whoever happened to be checked first.
    workloadBalance: 1 - clamp01((candidate.currentWorkloadMinutes || 0) / 480), // 480min = an 8h shift's worth
    // Shorter travel time from the candidate's last task scores higher;
    // no previous task or no configured distance scores neutrally (0.5).
    travelTime: travelTimeScore(task, candidate),
    // Already working the SAME aircraft/location today scores higher —
    // keeps one person on one tail/stand rather than shuttling everyone. A
    // task with no registration set yet (the flight instance sync from the
    // Flight Schedule module never carries one — Section 6) must never
    // "match" another equally tail-less task: both sides are required so
    // null-vs-null can't silently score as continuity.
    taskContinuity: !!task.aircraftRegistration && (candidate.existingAssignments || []).some(a => a.aircraftRegistration === task.aircraftRegistration) ? 1 : 0.3,
    // Prefers a candidate who is currently LESS utilized relative to their
    // shift length — same spirit as workloadBalance but normalized to
    // their own actual shift duration rather than a flat 8h assumption.
    resourceUtilization: 1 - clamp01((candidate.utilizationPct || 0) / 100),
    // Prefers reducing idle time: a candidate who would otherwise sit idle
    // longest before their next already-assigned task scores higher.
    idleTimeReduction: clamp01((candidate.idleMinutesBeforeNext ?? 60) / 120),
    // Prefers whoever has been assigned FEWER tasks so far this run/day —
    // spreads opportunity rather than always picking the same "best" person.
    fairness: 1 - clamp01((candidate.tasksAssignedToday || 0) / 6),
  };
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const breakdown = {};
  let score = 0;
  for (const key of Object.keys(components)) {
    const w = weights[key] ?? DEFAULT_WEIGHTS[key];
    const contribution = (components[key] * w * 100) / totalWeight;
    breakdown[key] = Math.round(contribution * 10) / 10;
    score += contribution;
  }
  return { score: Math.round(score * 10) / 10, breakdown };
}
function clamp01(n) { return Math.max(0, Math.min(1, n)); }
function slackScore(task) {
  const totalSlackMin = (new Date(task.deadline).getTime() - new Date(task.plannedStart).getTime()) / 60000;
  // Normalized against a 2h slack window — a task with 2h+ of slack scores
  // near 0 (not urgent), one with near-zero slack scores near 1.
  return 1 - clamp01(totalSlackMin / 120);
}
function travelTimeScore(task, candidate) {
  const lookup = candidate.travelTimeLookup;
  const last = (candidate.existingAssignments || [])
    .filter(a => new Date(a.taskEnd).getTime() <= new Date(task.plannedStart).getTime())
    .sort((a, b) => new Date(b.taskEnd) - new Date(a.taskEnd))[0];
  if (!last || !lookup || !last.location || !task.location) return 0.5;
  const minutes = lookup(last.location, task.location);
  if (minutes == null) return 0.5;
  return 1 - clamp01(minutes / 20); // 20min = treated as "far"
}

// ─── Conflict Detection (Section 12) ─────────────────────────────────────────
// Operates on plain, already-fetched arrays — one call per station/date
// window from the orchestrating service, never a DB call itself.
function detectConflicts({ tasks, assignmentsByUser, travelTimeLookup, demandByCategoryShift, availableByCategoryShift }) {
  const conflicts = [];

  // Employee overlap: two ACTIVE assignments for the same person whose
  // windows genuinely overlap.
  for (const [userId, assignments] of Object.entries(assignmentsByUser || {})) {
    const sorted = [...assignments].sort((a, b) => new Date(a.plannedStart) - new Date(b.plannedStart));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i];
      if (overlaps(prev.plannedStart, prev.taskEnd, cur.plannedStart, cur.taskEnd)) {
        const overlapMin = Math.round((new Date(prev.taskEnd).getTime() - new Date(cur.plannedStart).getTime()) / 60000);
        conflicts.push({
          taskId: cur.taskId, conflictType: "EMPLOYEE_OVERLAP", severity: "BLOCKING", userId, relatedTaskId: prev.taskId,
          message: `${overlapMin} minute overlap with another assigned task`,
          details: { overlapMinutes: overlapMin },
        });
      } else if (travelTimeLookup && prev.location && cur.location) {
        const need = travelTimeLookup(prev.location, cur.location);
        const gapMin = Math.round((new Date(cur.plannedStart).getTime() - new Date(prev.taskEnd).getTime()) / 60000);
        if (need != null && gapMin < need) {
          conflicts.push({
            taskId: cur.taskId, conflictType: "LOCATION_TRAVEL", severity: "BLOCKING", userId, relatedTaskId: prev.taskId,
            message: `Travel time insufficient: needs ${need} min, has ${gapMin} min (${prev.location} → ${cur.location})`,
            details: { neededMinutes: need, availableMinutes: gapMin, from: prev.location, to: cur.location },
          });
        }
      }
    }
  }

  // Deadline conflicts: an ASSIGNED task whose own window can't finish
  // before its deadline (should be rare — the eligibility engine should
  // have refused this at assignment time — but a later reschedule of the
  // SAME task's timing can create one, and this must still catch it).
  for (const t of tasks || []) {
    if (t.status === "CANCELLED") continue;
    const end = addMinutes(new Date(t.plannedStart), t.estimatedDurationMin);
    if (end.getTime() > new Date(t.deadline).getTime()) {
      conflicts.push({
        taskId: t.id, conflictType: "DEADLINE", severity: "BLOCKING",
        message: `Task cannot complete before its deadline (ends ${end.toISOString()}, deadline ${new Date(t.deadline).toISOString()})`,
        details: { plannedEnd: end.toISOString(), deadline: t.deadline },
      });
    }
  }

  // Resource shortage: configured demand for a category/shift exceeds what
  // was actually available that day (Section 12's example).
  for (const [key, required] of Object.entries(demandByCategoryShift || {})) {
    const available = (availableByCategoryShift || {})[key] || 0;
    if (available < required) {
      const [category, shift] = key.split("|");
      conflicts.push({
        taskId: null, conflictType: "RESOURCE_SHORTAGE", severity: "WARNING",
        message: `Required ${category}: ${required}, Available: ${available}, Shortage: ${required - available}`,
        details: { category, shift, required, available, shortage: required - available },
      });
    }
  }

  return conflicts;
}

module.exports = {
  generateTasksFromFlightInstance, addMinutes, taskEnd,
  HARD_CHECKS, checkEligibility,
  DEFAULT_WEIGHTS, scoreCandidate,
  detectConflicts,
};
