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
//      reference's fillAdvisory() does. NEITHER tier ever pulls a staff
//      member off their scheduled OFF day for routine coverage — real
//      operational feedback was explicit that a rest day is never a
//      resource to draw on for ordinary understaffing. Instead, a
//      shortfall on one shift is covered by SAME-DAY REDISTRIBUTION: moving
//      a staff member who is already working a DIFFERENT shift that day
//      and currently sits ABOVE that shift's own Mandatory Minimum floor (a
//      genuine surplus, never someone still needed there) onto the
//      short-staffed shift instead — respecting every rest-gap and
//      night-restriction rule for the shift they'd move INTO exactly as
//      strictly as a fresh assignment would. This keeps "as far as possible
//      follow the defined pattern" true in the sense that mattered to the
//      request: nobody's actual day off is ever touched, only which of
//      their scheduled WORKING shifts they cover that day. Only when
//      allowPatternOverrideForCoverage (the Generate tab's "Patterns +
//      Automatic" mode) is on, and same-day redistribution genuinely finds
//      nobody, is a last-resort "flexi" exigency fill allowed to draw on an
//      unlocked staff member's OFF day — tracked separately in
//      `flexiAssignments`, never silently indistinguishable from a routine
//      fill, and still never touching a pattern-locked staff member's
//      protected OFF day even then. Where NO eligible candidate exists at
//      all for a MANDATORY slot, it's reported as a (critical) violation;
//      an unmet ADVISORY slot is reported separately as a non-critical gap,
//      never blocking generation.

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

// Which Mandatory Coverage family (if any) a shift code belongs to — the
// classification other coverage checks (dashboardService's roster
// validation/coverage widgets) should use too, so "M1"/"MS"/"AS" etc. count
// toward the same Morning/Afternoon bucket a plain "M"/"A" does instead of
// each variant code needing its own B1/B2, and General/Break/Flexi-type
// codes (not in either fixed list, not night) correctly need no mandatory
// coverage check at all — same as this file's own coverage pass below,
// which only ever populates M/A/N buckets.
function shiftFamily(code, shiftDefsByCode) {
  if (isNight(code, shiftDefsByCode)) return "N";
  if (isMorn(code)) return "M";
  if (isAft(code)) return "A";
  return null;
}

// Default Mandatory Minimum Coverage: every shift needs >=1 B1, Night also
// needs >=1 B2 — exactly the hardcoded behavior this port had before the
// config became adjustable, preserved as the default so existing callers
// that don't pass mandatoryCoverageConfig see no behavior change. NCS
// defaults to disabled (same as CM) — a station opts in via Workload
// Config rather than this getting force-enabled under them.
const DEFAULT_MANDATORY_COVERAGE_CONFIG = {
  B1: { M: { enabled: true, min: 1 }, A: { enabled: true, min: 1 }, N: { enabled: true, min: 1 } },
  B2: { M: { enabled: false, min: 1 }, A: { enabled: false, min: 1 }, N: { enabled: true, min: 1 } },
  CM: { M: { enabled: false, min: 1 }, A: { enabled: false, min: 1 }, N: { enabled: false, min: 1 } },
  NCS: { M: { enabled: false, min: 1 }, A: { enabled: false, min: 1 }, N: { enabled: false, min: 1 } },
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
  absoluteDayAnchor, allowPatternOverrideForCoverage,
}) {
  const blocked = new Set(blockedUserIds || []);
  const lmpmLocked = new Set(lmpmLockedUserIds || []);
  const coverageConfig = mandatoryCoverageConfig || DEFAULT_MANDATORY_COVERAGE_CONFIG;
  const nightRules = (nightRestrictionRules || []).filter(
    r => r.enabled && r.type === "hard" && (r.conditionType === "night_only" || r.conditionType === "no_night"),
  );
  const grid = {}; // userId -> array of nDays codes (1-indexed access via day-1)
  // Both the flat 8-day ROTATION and a named Staff Allocation pattern are
  // meant to be a PERPETUAL cycle — real airline rotations don't reset to
  // day zero on the 1st of every month. Indexing purely by (day-1), the
  // position WITHIN the currently-generated month, made every month start
  // at the exact same phase regardless of how the previous month actually
  // ended, which both breaks the "Continue from Previous Roster" promise
  // and produces artificially long duty runs whenever a month's length
  // doesn't happen to land the reset on what would have been an OFF day.
  // absoluteDayAnchor (days between a fixed epoch and day 1 of the month
  // being generated — 0 when the caller doesn't care, e.g. existing tests)
  // is added to (day-1) so the cycle position keeps advancing across every
  // month boundary instead of restarting. Defaulting to 0 keeps this a
  // pure no-op for any caller that doesn't pass it.
  const dayAnchor = absoluteDayAnchor || 0;

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
        ? (pattern.codes[(dayAnchor + day - 1 + (pattern.offset || 0)) % pattern.codes.length] || "O")
        : ROTATION[(dayAnchor + day - 1 + offset) % ROTATION.length];

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

  // Step 5: two-tier coverage pass, per day — first Mandatory Minimum
  // Coverage (critical if unmet), then Advisory workload-driven sizing on
  // top of it (non-critical if unmet). See the module-header comment above
  // for the full same-day-redistribution / flexi-exigency design.
  const violations = [];
  const advisoryGaps = [];
  const flexiAssignments = []; // last-resort off-day fills, kept separate from ordinary assignments for transparency

  function eligibleBase(s, day) {
    if (blocked.has(s.id)) return false;
    if (leaveByUserDay?.[s.id]?.has(day)) return false;
    return true;
  }

  // Whether `s` could safely be assigned `shift` on `day`, looking only at
  // the days BEFORE it (their own grid up to day-1, or tailByUser for days
  // 1-3) and, for a Night assignment, the day after — independent of
  // whatever `s` is currently doing on `day` itself, since same-day
  // redistribution REPLACES that day's assignment rather than adding a
  // second one. Every real DGCA-style rest-gap/night-restriction rule
  // applies exactly as strictly as it would for a fresh assignment.
  function restGapOk(s, day, shift) {
    if (violatesNightRestriction(nightRules, s, shift, shiftDefsByCode, staffGroupMembersByGroupId)) return false;
    const tail = tailByUser?.[s.id] || ["O", "O", "O"];
    const prev = day > 1 ? grid[s.id][day - 2] : tail[0];
    const prev2 = day > 2 ? grid[s.id][day - 3] : (day === 2 ? tail[0] : tail[1]);
    const prev3 = day > 3 ? grid[s.id][day - 4] : (day === 3 ? tail[0] : day === 2 ? tail[1] : tail[2]);
    if (isNight(prev2, shiftDefsByCode) && isNight(prev, shiftDefsByCode)) return false;
    if (isNight(prev3, shiftDefsByCode) && isNight(prev2, shiftDefsByCode) && prev === "O") return false;
    if (shift === "M" && (isNight(prev, shiftDefsByCode) || isAft(prev))) return false;
    if (shift === "A" && isNight(prev, shiftDefsByCode)) return false;
    if (shift === "N") {
      const next = day < nDays ? grid[s.id][day] : undefined;
      if (isMorn(next)) return false; // would put an N immediately before an already-fixed Morning
    }
    return true;
  }

  // Rebalances one day for one category against per-shift targets (the
  // Mandatory floors themselves during the mandatory pass, or the fuller
  // Advisory targets layered on top during the advisory pass).
  // mandatoryFloors is passed separately so "surplus" always means "above
  // this shift's own Mandatory Minimum floor" even during the advisory
  // pass — never treating someone still needed to hit their OWN shift's
  // hard floor as available to give away.
  function rebalanceDay(day, category, targets, mandatoryFloors, { mandatory }) {
    const shifts = ["M", "A", "N"];
    const bucket = {};
    shifts.forEach(sh => { bucket[sh] = staff.filter(s => s.category === category && eligibleBase(s, day) && grid[s.id][day - 1] === sh); });

    shifts.forEach(deficitShift => {
      const target = targets[deficitShift] || 0;
      while (bucket[deficitShift].length < target) {
        // 1) Same-day redistribution: move a genuine surplus staff member
        // from a different shift they're already working today — never
        // touches anyone whose day is OFF.
        let moved = false;
        for (const sourceShift of shifts) {
          if (sourceShift === deficitShift) continue;
          const floor = mandatoryFloors?.[sourceShift] || 0;
          if (bucket[sourceShift].length <= floor) continue; // no real surplus there
          const donorIdx = bucket[sourceShift].findIndex(s => restGapOk(s, day, deficitShift));
          if (donorIdx === -1) continue;
          const [donor] = bucket[sourceShift].splice(donorIdx, 1);
          grid[donor.id][day - 1] = deficitShift;
          bucket[deficitShift].push(donor);
          moved = true;
          break;
        }
        if (moved) continue;

        // 2) Exigency "flexi" fallback — a genuine last resort, only when
        // the planner opted into "Patterns + Automatic", drawing on an
        // UNLOCKED staff member's OFF day (a pattern-locked staff member's
        // OFF day stays protected even here).
        if (allowPatternOverrideForCoverage) {
          const flexiCandidate = staff.find(s => (
            s.category === category && eligibleBase(s, day) && grid[s.id][day - 1] === "O"
            && !lmpmLocked.has(s.id) && restGapOk(s, day, deficitShift)
          ));
          if (flexiCandidate) {
            grid[flexiCandidate.id][day - 1] = deficitShift;
            flexiAssignments.push({ userId: flexiCandidate.id, day, shift: deficitShift, category });
            bucket[deficitShift].push(flexiCandidate);
            continue;
          }
        }

        // 3) Genuinely can't be covered — report honestly rather than
        // fabricating coverage or breaking a safety rule.
        const target_ = mandatory ? violations : advisoryGaps;
        target_.push({ day, shift: deficitShift, category, issue: `No available ${category} to cover ${deficitShift} on day ${day}` });
        break;
      }
    });
  }

  for (let day = 1; day <= nDays; day++) {
    ["B1", "B2", "CM", "NCS"].forEach(category => {
      const floors = {};
      ["M", "A", "N"].forEach(sh => {
        const cfg = coverageConfig[category]?.[sh];
        floors[sh] = cfg && cfg.enabled ? Math.max(1, +cfg.min || 1) : 0;
      });
      if (floors.M || floors.A || floors.N) rebalanceDay(day, category, floors, floors, { mandatory: true });
    });
  }

  if (advisoryDemand) {
    for (let day = 1; day <= nDays; day++) {
      const dayDemand = advisoryDemand[day];
      if (!dayDemand) continue;
      const categoriesToday = new Set();
      ["M", "A", "N"].forEach(sh => { const sd = dayDemand[sh]; if (sd) Object.keys(sd).forEach(c => categoriesToday.add(c)); });
      categoriesToday.forEach(category => {
        const floors = {};
        const targets = {};
        ["M", "A", "N"].forEach(sh => {
          const cfg = coverageConfig[category]?.[sh];
          floors[sh] = cfg && cfg.enabled ? Math.max(1, +cfg.min || 1) : 0;
          targets[sh] = Math.max(floors[sh], dayDemand[sh]?.[category] || 0);
        });
        rebalanceDay(day, category, targets, floors, { mandatory: false });
      });
    }
  }

  const assignments = [];
  for (const s of staff) {
    for (let day = 1; day <= nDays; day++) {
      assignments.push({ userId: s.id, day, code: grid[s.id][day - 1] });
    }
  }

  return { assignments, violations, advisoryGaps, flexiAssignments, staffCount: staff.length };
}

module.exports = { buildRosterAssignments, ROTATION, DEFAULT_MANDATORY_COVERAGE_CONFIG, shiftFamily };
