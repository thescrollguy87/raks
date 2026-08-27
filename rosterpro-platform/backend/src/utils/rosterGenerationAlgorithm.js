// Pure, DB-free scheduling logic. Kept separate from
// services/rosterGenerationService.js (which fetches staff/leave from the
// DB and persists the result) specifically so this — the part that's
// actually worth getting right and testing thoroughly — can be unit tested
// with plain objects, no mocking required.
//
// Algorithm, in order:
//   1. Each staff member gets an 8-day rotation (M,M,A,A,N,N,O,O), offset by
//      their position in the roster so the whole station isn't on the same
//      phase of the cycle at once.
//   2. Blocked staff (expired quals/license) get all-OFF — never scheduled.
//   3. Approved leave overrides the rotation for those specific days.
//   4. A rest-gap pass prevents a Night shift immediately followed by a
//      Morning shift the next day (N→M) — not enough turnaround time.
//   5. A coverage pass enforces the same rule the roster generator's
//      publish step and the dashboard's coverage widget both check: every
//      shift needs ≥1 B1, and Night specifically needs ≥1 B2. Where the
//      rotation alone doesn't satisfy this, an available (not blocked, not
//      on leave, currently OFF that day) staff member of the right
//      category is pulled onto that shift. Where NO such candidate exists,
//      it's reported as a violation rather than silently left uncovered.

const ROTATION = ["M", "M", "A", "A", "N", "N", "O", "O"];

// rotationOffsetByUser lets a caller continue each staff member's rotation
// from a previous month instead of restarting everyone at phase 0 (see
// rosterGenerationService's "continue from previous roster" option) —
// defaults to each staff's index in the list, same as before this existed.
function buildRosterAssignments({ staff, nDays, leaveByUserDay, blockedUserIds, rotationOffsetByUser }) {
  const blocked = new Set(blockedUserIds || []);
  const grid = {}; // userId -> array of nDays codes (1-indexed access via day-1)

  // Step 1 + 2 + 3: base rotation, blocked staff, leave overrides.
  staff.forEach((s, idx) => {
    const offset = rotationOffsetByUser?.[s.id] ?? idx;
    const codes = new Array(nDays);
    for (let day = 1; day <= nDays; day++) {
      if (blocked.has(s.id)) { codes[day - 1] = "O"; continue; }
      const onLeave = leaveByUserDay?.[s.id]?.has(day);
      if (onLeave) { codes[day - 1] = "L"; continue; }
      codes[day - 1] = ROTATION[(day - 1 + offset) % ROTATION.length];
    }
    grid[s.id] = codes;
  });

  // Step 4: rest-gap pass — no Night immediately followed by Morning.
  for (const s of staff) {
    const codes = grid[s.id];
    for (let day = 2; day <= nDays; day++) {
      if (codes[day - 2] === "N" && codes[day - 1] === "M") {
        codes[day - 1] = "O";
      }
    }
  }

  // Step 5: minimum coverage pass. Candidates for an M-shift gap must NOT
  // have worked Night the day before — the coverage pass is not allowed to
  // reintroduce the exact fatigue violation step 4 just removed. This is a
  // deliberate priority: an uncovered shift becomes a reported violation
  // for a human to resolve; a fatigued engineer never gets rescheduled
  // just to make the numbers look right.
  const violations = [];

  for (let day = 1; day <= nDays; day++) {
    for (const shift of ["M", "A", "N"]) {
      ensureCategoryCovered(shift, "B1", day);
      if (shift === "N") ensureCategoryCovered(shift, "B2", day);
    }
  }

  function ensureCategoryCovered(shift, category, day) {
    const covered = staff.some(s => s.category === category && grid[s.id][day - 1] === shift);
    if (covered) return;

    const candidate = staff.find(s => {
      if (s.category !== category) return false;
      if (blocked.has(s.id)) return false;
      if (leaveByUserDay?.[s.id]?.has(day)) return false;
      if (grid[s.id][day - 1] !== "O") return false;
      if (shift === "M" && day > 1 && grid[s.id][day - 2] === "N") return false; // rest-gap guard
      return true;
    });
    if (candidate) {
      grid[candidate.id][day - 1] = shift;
    } else {
      violations.push({ day, shift, category, issue: `No available ${category} to cover ${shift} on day ${day}` });
    }
  }

  const assignments = [];
  for (const s of staff) {
    for (let day = 1; day <= nDays; day++) {
      assignments.push({ userId: s.id, day, code: grid[s.id][day - 1] });
    }
  }

  return { assignments, violations, staffCount: staff.length };
}

module.exports = { buildRosterAssignments, ROTATION };
