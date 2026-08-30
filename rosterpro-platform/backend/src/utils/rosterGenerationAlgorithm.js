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
//      assuming everyone was OFF on day zero. Any enabled night_only/no_night
//      Workload Rule that applies to this staff member is enforced here too
//      (proactively, not just flagged after the fact) — same as the
//      reference's applyAutoRoster() checking nightRestrictionRules inline
//      in the base rotation loop.
//   5. A two-tier coverage pass — MANDATORY then ADVISORY — enforces the
//      Mandatory Minimum Coverage grid (`mandatoryCoverageConfig`, keyed by
//      category then shift, e.g. every shift needs >=1 B1 and Night needs
//      >=1 B2 by default) exactly as the reference's fillMandatory() does,
//      then tops up further, non-critical shortfalls against
//      `advisoryDemand` (the day/shift/category targets
//      workloadEngine.computeDailyShiftDemand produces) exactly as the
//      reference's fillAdvisory() does. Both passes share one eligibility
//      guard: the candidate must currently be OFF that day, must not be
//      locked to an approved LMPM pattern (`lmpmLockedUserIds` — pulling a
//      pattern-locked staff member onto a shift their pattern says they're
//      off is never allowed, even under coverage pressure, matching the
//      reference's `ALLOCATIONS[s.si].patternId !== 'MANUAL'` check), must
//      not violate any enabled night_only/no_night rule that applies to
//      them, and must not land on a day the rest-gap pass already committed
//      to as a mandatory rest day or create a fresh rest-gap violation.
//      Where NO eligible candidate exists for a MANDATORY slot, it's
//      reported as a (critical) violation; an unmet ADVISORY slot is
//      reported separately as a non-critical gap, never blocking generation.

const { ruleAppliesToStaff } = require("./ruleEngine");

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
function isDutyType(code, shiftDefsByCode) { return shiftType(code, shiftDefsByCode) === "duty"; }

// Default Mandatory Minimum Coverage: every shift needs >=1 B1, Night also
// needs >=1 B2 — exactly the hardcoded behavior this port had before the
// config became adjustable, preserved as the default so existing callers
// that don't pass mandatoryCoverageConfig see no behavior change.
const DEFAULT_MANDATORY_COVERAGE_CONFIG = {
  B1: { M: { enabled: true, min: 1 }, A: { enabled: true, min: 1 }, N: { enabled: true, min: 1 } },
  B2: { M: { enabled: false, min: 1 }, A: { enabled: false, min: 1 }, N: { enabled: true, min: 1 } },
  CM: { M: { enabled: false, min: 1 }, A: { enabled: false, min: 1 }, N: { enabled: false, min: 1 } },
};

function violatesNightRestriction(rules, s, shift, shiftDefsByCode, staffGroupMembersByGroupId) {
  if (!rules || !rules.length) return false;
  const targetIsNight = isNight(shift, shiftDefsByCode);
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!ruleAppliesToStaff(rule, s, staffGroupMembersByGroupId)) continue;
    if (rule.conditionType === "no_night" && targetIsNight) return true;
    if (rule.conditionType === "night_only" && !targetIsNight && isDutyType(shift, shiftDefsByCode)) return true;
  }
  return false;
}

function buildRosterAssignments({
  staff, nDays, leaveByUserDay, blockedUserIds, tailByUser, patternByUser, shiftDefsByCode,
  mandatoryCoverageConfig, lmpmLockedUserIds, nightRestrictionRules, staffGroupMembersByGroupId, advisoryDemand,
}) {
  const blocked = new Set(blockedUserIds || []);
  const lmpmLocked = new Set(lmpmLockedUserIds || []);
  const coverageConfig = mandatoryCoverageConfig || DEFAULT_MANDATORY_COVERAGE_CONFIG;
  const nightRules = (nightRestrictionRules || []).filter(
    r => r.enabled && r.type === "hard" && (r.conditionType === "night_only" || r.conditionType === "no_night"),
  );
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
        if (violatesNightRestriction(nightRules, s, proposed, shiftDefsByCode, staffGroupMembersByGroupId)) proposed = "O";
      }

      codes[day - 1] = proposed;
    }
    grid[s.id] = codes;
  });

  // Step 5: two-tier coverage pass, per day in shift order M, A, N — first
  // Mandatory Minimum Coverage (critical if unmet), then Advisory workload-
  // driven sizing on top of it (non-critical if unmet).
  const violations = [];
  const advisoryGaps = [];

  function findEligible(shift, category, day) {
    return staff.find(s => {
      if (s.category !== category) return false;
      if (blocked.has(s.id)) return false;
      if (leaveByUserDay?.[s.id]?.has(day)) return false;
      if (grid[s.id][day - 1] !== "O") return false; // must currently be idle that day
      if (lmpmLocked.has(s.id)) return false; // never pull a pattern-locked staff member off their pattern's OFF day
      if (violatesNightRestriction(nightRules, s, shift, shiftDefsByCode, staffGroupMembersByGroupId)) return false;
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
  }

  function fillCategory(shift, category, day, minCount, { mandatory }) {
    let onShift = staff.filter(s => s.category === category && grid[s.id][day - 1] === shift).length;
    while (onShift < minCount) {
      const candidate = findEligible(shift, category, day);
      if (!candidate) {
        const target = mandatory ? violations : advisoryGaps;
        target.push({ day, shift, category, issue: `No available ${category} to cover ${shift} on day ${day}` });
        break;
      }
      grid[candidate.id][day - 1] = shift;
      onShift++;
    }
  }

  for (let day = 1; day <= nDays; day++) {
    ["B1", "B2", "CM"].forEach(category => {
      ["M", "A", "N"].forEach(shift => {
        const cfg = coverageConfig[category]?.[shift];
        if (cfg && cfg.enabled) fillCategory(shift, category, day, Math.max(1, +cfg.min || 1), { mandatory: true });
      });
    });
  }

  if (advisoryDemand) {
    for (let day = 1; day <= nDays; day++) {
      const dayDemand = advisoryDemand[day];
      if (!dayDemand) continue;
      ["M", "A", "N"].forEach(shift => {
        const shiftDemand = dayDemand[shift];
        if (!shiftDemand) return;
        Object.entries(shiftDemand).forEach(([category, target]) => {
          if (!target || target <= 0) return;
          fillCategory(shift, category, day, target, { mandatory: false });
        });
      });
    }
  }

  const assignments = [];
  for (const s of staff) {
    for (let day = 1; day <= nDays; day++) {
      assignments.push({ userId: s.id, day, code: grid[s.id][day - 1] });
    }
  }

  return { assignments, violations, advisoryGaps, staffCount: staff.length };
}

module.exports = { buildRosterAssignments, ROTATION, DEFAULT_MANDATORY_COVERAGE_CONFIG };
