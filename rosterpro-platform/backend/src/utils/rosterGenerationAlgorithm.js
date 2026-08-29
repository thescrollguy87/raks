// Pure, DB-free scheduling logic. Kept separate from
// services/rosterGenerationService.js (which fetches staff/leave from the
// DB and persists the result) specifically so this — the part that's
// actually worth getting right and testing thoroughly — can be unit tested
// with plain objects, no mocking required.
//
// Ported from reference-ui/index.html's applyAutoRoster()/fillMinCat(), which
// is the source of truth for this algorithm. Steps, in order:
//   1. Each staff member gets an 8-day rotation (M,M,A,A,N,N,O,O), offset by
//      twice their position in the roster (idx*2) so the whole station isn't
//      on the same phase of the cycle at once — same offset formula as the
//      reference's "auto-distribute" default.
//   2. Blocked staff (expired quals/license) get all-OFF — never scheduled.
//   3. Approved leave overrides the rotation for those specific days.
//   4. A rest-gap pass, applied inline day-by-day (not as a separate sweep,
//      to match the reference's sequential computation), enforces every
//      illegal-sequence rule the reference encodes: Morning can't follow
//      Night or Afternoon, Afternoon can't follow Night, and two consecutive
//      Night shifts force the following day OFF with a second OFF day after
//      that. `tailByUser` carries each staff member's real last 3 shift
//      codes from the previous month (when "continue from previous" is on)
//      so this look-back is continuous across the month boundary instead of
//      assuming everyone was OFF on day zero.
//   5. A coverage pass enforces the same rule the roster generator's
//      publish step and the dashboard's coverage widget both check: every
//      shift needs ≥1 B1, and Night specifically needs ≥1 B2. Where the
//      rotation alone doesn't satisfy this, an available (not blocked, not
//      on leave, currently OFF that day) staff member of the right category
//      and not coming off a shift that would itself create a rest-gap
//      violation is pulled onto that shift — same eligibility guard as the
//      reference's fillMinCat, plus guards the reference's fillMinCat omits
//      and this port deliberately adds: the candidate must currently be OFF
//      that day (otherwise a tightly-staffed roster can silently overwrite
//      their own already-assigned shift); no fill of any kind — Morning,
//      Afternoon, or Night — is allowed to land on a day the rest-gap pass
//      already committed to as a mandatory rest day (the day right after 2
//      consecutive nights, or the second OFF day after that); and a Night
//      fill specifically is also rejected if it would land immediately
//      before a day already fixed to Morning. Without these, coverage-
//      filling can retroactively undo a mandatory rest day the earlier pass
//      just committed to, recreating the exact violation step 4 exists to
//      prevent. Where NO eligible candidate exists, it's reported as a
//      violation rather than silently left uncovered.

const ROTATION = ["M", "M", "A", "A", "N", "N", "O", "O"];

// Classification helpers matching reference-ui's isMorn/isAft/isNight/isLeave
// closures exactly: Morning/Afternoon are fixed code lists (a pattern using
// a custom code like "M1" or "AS" still counts as Morning/Afternoon for the
// rest-gap rules), while Night/Leave are looked up by the shift definition's
// `type` — falling back to this DEFAULT map (which reproduces the base M/A/
// N/O/L codes' real seeded types) when no shiftDefsByCode is supplied, so
// the no-pattern path's behavior is unchanged whether or not one is passed.
const MORN_CODES = new Set(["M", "M1", "MS"]);
const AFT_CODES = new Set(["A", "A1", "A2", "AS"]);
const DEFAULT_SHIFT_TYPES = { M: "duty", A: "duty", N: "night", O: "off", L: "leave" };
function shiftType(code, shiftDefsByCode) {
  return shiftDefsByCode?.[code] ?? DEFAULT_SHIFT_TYPES[code] ?? "duty";
}
function isMorn(code) { return MORN_CODES.has(code); }
function isAft(code) { return AFT_CODES.has(code); }
function isNight(code, shiftDefsByCode) { return shiftType(code, shiftDefsByCode) === "night"; }
function isLeaveType(code, shiftDefsByCode) { return shiftType(code, shiftDefsByCode) === "leave"; }

function buildRosterAssignments({ staff, nDays, leaveByUserDay, blockedUserIds, tailByUser, patternByUser, shiftDefsByCode }) {
  const blocked = new Set(blockedUserIds || []);
  const grid = {}; // userId -> array of nDays codes (1-indexed access via day-1)

  // Step 1 + 2 + 3 + 4: base rotation, blocked staff, leave overrides, rest-gap.
  staff.forEach((s, idx) => {
    const offset = idx * 2;
    const tail = tailByUser?.[s.id] || ["O", "O", "O"]; // [lastDay, 2ndLast, 3rdLast] of previous month
    // Staff Allocation tab: a staff member assigned a Shift Pattern gets that
    // pattern's own cycle + start-day offset instead of the flat 8-day
    // ROTATION every unpatterned staff member gets by list position — same
    // usePatterns branch reference-ui's applyAutoRoster() has, and everything
    // below (rest-gap pass, coverage pass) is unchanged either way, exactly
    // as in the reference: only how `proposed` is first computed differs.
    const pattern = patternByUser?.[s.id];
    const codes = new Array(nDays);

    for (let day = 1; day <= nDays; day++) {
      if (blocked.has(s.id)) { codes[day - 1] = "O"; continue; }
      const onLeave = leaveByUserDay?.[s.id]?.has(day);
      if (onLeave) { codes[day - 1] = "L"; continue; }

      let proposed = pattern?.codes?.length
        ? (pattern.codes[(day - 1 + (pattern.offset || 0)) % pattern.codes.length] || "O")
        : ROTATION[(day - 1 + offset) % ROTATION.length];

      const prev = day > 1 ? codes[day - 2] : tail[0];
      const prev2 = day > 2 ? codes[day - 3] : (day === 2 ? tail[0] : tail[1]);
      const prev3 = day > 3 ? codes[day - 4] : (day === 3 ? tail[0] : day === 2 ? tail[1] : tail[2]);

      if (!isLeaveType(proposed, shiftDefsByCode)) {
        if (isMorn(proposed) && isNight(prev, shiftDefsByCode)) proposed = "O";
        if (isMorn(proposed) && isAft(prev)) proposed = "O";
        if (isAft(proposed) && isNight(prev, shiftDefsByCode)) proposed = "O";
        if (isNight(prev2, shiftDefsByCode) && isNight(prev, shiftDefsByCode)) proposed = "O"; // after 2N -> OFF
        if (isNight(prev3, shiftDefsByCode) && isNight(prev2, shiftDefsByCode) && prev === "O") proposed = "O"; // 2nd mandatory OFF day
      }

      codes[day - 1] = proposed;
    }
    grid[s.id] = codes;
  });

  // Step 5: minimum coverage pass, per day in shift order M, A, N (B1), then
  // N again (B2) — matching the reference's fillMinCat call order.
  const violations = [];

  function ensureCategoryCovered(shift, category, day) {
    const covered = staff.some(s => s.category === category && grid[s.id][day - 1] === shift);
    if (covered) return;

    const candidate = staff.find(s => {
      if (s.category !== category) return false;
      if (blocked.has(s.id)) return false;
      if (leaveByUserDay?.[s.id]?.has(day)) return false;
      if (grid[s.id][day - 1] !== "O") return false; // must currently be idle that day
      const tail = tailByUser?.[s.id] || ["O", "O", "O"];
      const prev = day > 1 ? grid[s.id][day - 2] : tail[0];
      const prev2 = day > 2 ? grid[s.id][day - 3] : (day === 2 ? tail[0] : tail[1]);
      const prev3 = day > 3 ? grid[s.id][day - 4] : (day === 3 ? tail[0] : day === 2 ? tail[1] : tail[2]);
      // The reference's own fillMinCat has no guard here at all, which lets
      // any fill — not just a Night fill — land on a day the earlier
      // rest-gap pass already committed to as a mandatory rest day (the day
      // right after 2 consecutive nights, or the second OFF day after that),
      // undoing that rest. This is the one place this port deliberately
      // diverges from a literal reference copy: a tightly-staffed scenario
      // must never have coverage-filling reintroduce a rest-gap violation
      // the earlier pass just removed.
      if (isNight(prev2, shiftDefsByCode) && isNight(prev, shiftDefsByCode)) return false;
      if (isNight(prev3, shiftDefsByCode) && isNight(prev2, shiftDefsByCode) && prev === "O") return false;
      if (shift === "M" && (isNight(prev, shiftDefsByCode) || isAft(prev))) return false; // rest-gap guard
      if (shift === "A" && isNight(prev, shiftDefsByCode)) return false;
      if (shift === "N") {
        const next = day < nDays ? grid[s.id][day] : undefined;
        if (isMorn(next)) return false; // would put an N immediately before an already-fixed Morning
      }
      return true;
    });
    if (candidate) {
      grid[candidate.id][day - 1] = shift;
    } else {
      violations.push({ day, shift, category, issue: `No available ${category} to cover ${shift} on day ${day}` });
    }
  }

  for (let day = 1; day <= nDays; day++) {
    ensureCategoryCovered("M", "B1", day);
    ensureCategoryCovered("A", "B1", day);
    ensureCategoryCovered("N", "B1", day);
    ensureCategoryCovered("N", "B2", day);
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
