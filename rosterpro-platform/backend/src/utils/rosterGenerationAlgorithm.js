// Pure, DB-free scheduling logic. Kept separate from
// services/rosterGenerationService.js (which fetches staff/leave from the
// DB and persists the result) specifically so this — the part that's
// actually worth getting right and testing thoroughly — can be unit tested
// with plain objects, no mocking required.
//
// Ported from reference-ui/index.html's applyAutoRoster()/fillMinCat(), which
// is the source of truth for this algorithm. Steps, in order:
//   1. Each unpatterned staff member gets their CATEGORY's own demand-
//      weighted cycle (see buildCategoryCycle — a perfectly even category
//      reproduces the original flat 8-day M,M,A,A,N,N,O,O), offset by
//      their position among same-category staff so the whole category
//      isn't on the same phase of the cycle at once — same spreading goal
//      as the reference's "auto-distribute" default, generalized to work
//      for a cycle of any shape, not just the original uniformly-paired one.
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
//      their scheduled WORKING shifts they cover that day. When same-day
//      redistribution genuinely finds nobody, a last-resort "flexi"
//      exigency fill is allowed to draw on an unlocked staff member's OFF
//      day instead — ALWAYS for a MANDATORY slot (that floor is described
//      everywhere else in this app as non-negotiable, so leaving it fully
//      unmet when one off-day pull could close it is the worse outcome),
//      but for an ADVISORY slot only when allowPatternOverrideForCoverage
//      (the Generate tab's "Patterns + Automatic" mode) is on. Either way
//      the candidate still has to pass every real rest-gap/night-
//      restriction/compliance check a fresh assignment would — "last
//      resort" never means "unsafe" — tracked separately in
//      `flexiAssignments` (each entry flagged `mandatory: true/false`),
//      never silently indistinguishable from a routine fill, and still
//      never touching a pattern-locked staff member's protected OFF day
//      even then. Where NO eligible candidate exists at all for a
//      MANDATORY slot, it's reported as a (critical) violation; an unmet
//      ADVISORY slot is reported separately as a non-critical gap, never
//      blocking generation.

const { ruleAppliesToStaff } = require("./ruleEngine");

const ROTATION = ["M", "M", "A", "A", "N", "N", "O", "O"];

// When nobody's picked a Staff Allocation pattern, every unpatterned staff
// member in a category used to get this exact same flat ROTATION
// regardless of how that category's REAL workload actually splits across
// shifts — an even 2:2:2:2 M:A:N:O cycle whether the category's real work
// is mostly Night (weekly/service checks, wheel/brake changes — typical
// heavy-maintenance NCS/CM/B2 demand) or mostly Morning/Afternoon
// (transit/PDC-driven B1 demand). buildCategoryCycle instead derives each
// category's OWN cycle from its real average per-shift demand (the same
// advisoryDemand workloadEngine.computeDailyShiftDemand produces, already
// the source the coverage pass below compares against) — proportionally
// more Night slots for a Night-heavy category, proportionally more
// Morning/Afternoon for one that isn't.
//
// The one non-negotiable physical constraint this has to respect is the
// hardcoded "2 consecutive nights -> 2 forced rest days" safety rule a few
// dozen lines below (isNight(prev2)&&isNight(prev) -> OFF): every 2 Night
// slots a cycle contains cost exactly 2 OFF slots, non-negotiably. That
// means a category whose real demand is mostly Night necessarily ends up
// with a LOWER overall on-duty cadence than the original flat rotation's
// 75% (6-of-8) — confirmed directly with the user as the intended
// tradeoff (closing the real "not enough night coverage, too much
// morning/afternoon" gap matters more than preserving a uniform 75%
// cadence for every category regardless of what it actually needs), not
// an artifact to engineer back down. A perfectly even 1:1:1 M:A:N category
// reproduces the exact original M,M,A,A,N,N,O,O (verified: maWorkSlots
// below works out to 4, split 2/2).
function buildCategoryCycle(category, advisoryDemand, nDays) {
  let dM = 0, dA = 0, dN = 0;
  for (let d = 1; d <= nDays; d++) {
    const day = advisoryDemand?.[d];
    if (!day) continue;
    dM += day.M?.[category] || 0;
    dA += day.A?.[category] || 0;
    dN += day.N?.[category] || 0;
  }
  // No computed demand at all for this category (e.g. STO, which sits
  // outside the whole mandatory/advisory workload system) — nothing to
  // weight from, so this category's staff keep today's flat rotation
  // exactly as before this change.
  if (dM + dA + dN <= 0) return ROTATION;

  if (dN <= 0) {
    // No real Night demand for this category at all — no forced-rest
    // overhead to plan around, so just split Morning/Afternoon by their
    // own ratio over a short cycle.
    const mCount = Math.min(3, Math.max(1, Math.round(4 * dM / (dM + dA || 1))));
    const aCount = Math.max(1, 4 - mCount);
    return [...Array(mCount).fill("M"), ...Array(aCount).fill("A")];
  }

  // One Night-pair (N,N,O,O — 2 work + its 2 forced-rest days, the
  // smallest legal unit) is the base building block; maWorkSlots is how
  // many Morning/Afternoon work-slots accompany it, sized to match the
  // SAME (Morning+Afternoon):Night ratio real demand has. Capped at 10 so
  // a category with only token Night demand doesn't balloon into an
  // impractically long cycle.
  const maWorkSlots = Math.min(10, Math.max(0, Math.round((2 * (dM + dA)) / dN)));
  const mCount = Math.round((maWorkSlots * dM) / (dM + dA || 1));
  const aCount = maWorkSlots - mCount;
  const cycle = [];
  if (mCount) cycle.push(...Array(mCount).fill("M"));
  if (aCount) cycle.push(...Array(aCount).fill("A"));
  cycle.push("N", "N", "O", "O");
  return cycle;
}

// Classification helpers matching reference-ui's isMorn/isAft/isNight/isLeave
// closures exactly: Morning/Afternoon are fixed code lists (a pattern using
// a custom code like "M1" or "AS" still counts as Morning/Afternoon for the
// rest-gap rules), while Night/Leave are looked up by the shift definition's
// `type` — falling back to this DEFAULT map (which reproduces the base M/A/
// N/O/L codes' real seeded types) when no shiftDefsByCode is supplied, so
// the no-pattern path's behavior is unchanged whether or not one is passed.
const MORN_CODES = new Set(["M", "M1", "MS"]);
const AFT_CODES = new Set(["A", "A1", "A2", "AS"]);
const DEFAULT_SHIFT_TYPES = { M: "duty", A: "duty", N: "night", O: "off", L: "leave", TRG: "training", D: "deputation" };

// Approved leave resolves to its own shift code — plain "L" for ordinary
// leave (annual/sick/casual/medical/LWP/other), but Training and Deputation
// get their own distinct codes so the roster grid (and everything
// downstream that reads a ShiftDefinition's `type`, e.g. dashboard "on
// leave" counts) can tell them apart from real leave. Mirrors
// LEAVE_CODE_DEFAULTS in rosterGenerationService.js, which is what actually
// keeps TRG/D's ShiftDefinition rows seeded — kept as a small local literal
// map here (not imported) since this file is deliberately DB-free/pure.
const LEAVE_TYPE_CODES = { TRAINING: "TRG", DEPUTATION: "D" };
function leaveCodeForType(leaveType) { return LEAVE_TYPE_CODES[leaveType] || "L"; }
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

// "Continue from Previous Roster" promises (per its own UI tooltip) that a
// staff member's rotation picks up from how their previous month REALLY
// ended, not a fresh start. Before this, that promise only covered the
// rest-gap look-back (suppressing an immediately-illegal sequence) — the
// day-1 PROPOSED code itself still came purely from absoluteDayAnchor's
// days-since-epoch arithmetic, which assumes an unbroken mathematical cycle
// since a fixed reference point. Real operational adjustments mid-month
// (leave, a mandatory-coverage flexi pull, same-day redistribution, a hand
// edit) can leave a staff member's TRUE position in their own cycle out of
// step with that pure formula by month-end — the new month would then
// silently snap back to the "theoretical" phase instead of genuinely
// continuing, e.g. reopening with an extra OFF day for someone who had
// already served it last month. This finds the index in `codes` (the flat
// ROTATION or a named pattern's own cycle) that day 1 of the new month
// should use by locating the staff member's actual last known code within
// it — preferring a position whose predecessor also matches their 2nd-last
// code, to disambiguate a cycle where that code repeats (e.g. "O" appearing
// twice in ROTATION). Returns null (no resync) when there's nothing to
// anchor to: brand-new tail data, or a last code (e.g. "L", or a flexi/
// redistribution code not native to this cycle) that doesn't appear in
// `codes` at all — callers fall back to the day-anchor formula in that
// case, so this is a pure improvement, never a regression, wherever it
// can't confidently resync.
// A real licensing hierarchy, not a per-station opt-in: every B1 engineer
// is, by the nature of the B1 license itself, also qualified to perform CM
// (Certifying Mechanic) work — confirmed directly with the user. Unlike
// `secondaryCategories` (a per-staff-member flag for a qualification that
// varies person to person, e.g. a specific Station I/C also holding CM
// certification on top of some OTHER primary category), this applies to
// every B1 staff member automatically, present and future, with nothing to
// flag per person. Keyed by primary category -> categories it also covers.
const CATEGORY_HIERARCHY = { B1: ["CM"] };

// Every category a staff member's shift should be CREDITED toward for
// reporting purposes — primary, hierarchy-implied, and explicit secondary —
// deduped. Confirmed directly with the user that this is a READ-ONLY,
// reporting-side fact only: Coverage Analysis uses it to correctly tally a
// shift someone was deliberately, manually placed into (e.g. a B1 Station
// I/C manually rostered onto a CM-short shift), but roster GENERATION
// itself (rebalanceDay below) deliberately does NOT use this to
// automatically move anyone across categories — same-day redistribution and
// the off-day flexi fallback both stay strictly same-category. A
// cross-category shortfall is left as an honestly-reported gap for a human
// to resolve by hand, either by adding real headcount in that category or
// by deliberately choosing to move someone's day off themselves — never a
// decision the generator makes silently on its own.
function creditedCategories(s) {
  return [...new Set([s.category, ...(CATEGORY_HIERARCHY[s.category] || []), ...(s.secondaryCategories || [])])].filter(Boolean);
}

function resyncCycleStart(codes, tail) {
  if (!codes?.length || tail?.[0] == null) return null;
  const len = codes.length;
  const candidates = [];
  for (let i = 0; i < len; i++) if (codes[i] === tail[0]) candidates.push(i);
  if (!candidates.length) return null;
  const refined = candidates.length > 1 ? candidates.filter(i => codes[(i - 1 + len) % len] === tail[1]) : candidates;
  const picked = refined.length === 1 ? refined[0] : candidates[0];
  return (picked + 1) % len;
}

function buildRosterAssignments({
  staff, nDays, leaveByUserDay, blockedUserIds, tailByUser, patternByUser, shiftDefsByCode,
  mandatoryCoverageConfig, lmpmLockedUserIds, nightRestrictionRules, staffGroupMembersByGroupId, advisoryDemand,
  absoluteDayAnchor, allowPatternOverrideForCoverage, trainingPendingUserIds,
}) {
  const blocked = new Set(blockedUserIds || []);
  const lmpmLocked = new Set(lmpmLockedUserIds || []);
  // Distinct from `blocked`: a staff member whose mandatory training was
  // never completed (not expired — there's no date to derive that from,
  // see the schema's own note on this) is still assignable to admin/office
  // duty via an explicit Staff Allocation pattern (the station's own
  // deliberate choice), just never counted toward, donated from, or
  // flexi-pulled into real category coverage. An UNPATTERNED training-
  // pending staff member has no admin-duty alternative to fall back on, so
  // defaults to OFF exactly like `blocked` rather than cycling through the
  // flat rotation's real M/A/N codes with nothing to stop it.
  const trainingPending = new Set(trainingPendingUserIds || []);
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

  // Cached per category, not per staff member — buildCategoryCycle only
  // depends on the category's own demand series, never on who's in it.
  const cycleByCategory = {};
  function fallbackCycleFor(category) {
    if (!category) return ROTATION;
    if (!cycleByCategory[category]) cycleByCategory[category] = buildCategoryCycle(category, advisoryDemand, nDays);
    return cycleByCategory[category];
  }
  // How many UNPATTERNED staff share each category's fallback cycle —
  // needed up front (not discoverable mid-iteration) so their offsets can
  // be spread evenly across the FULL cycle length, not just incrementally.
  // A fixed step size (whether the original flat rotation's 2, or a
  // naive 1) breaks down once a category's real headcount is smaller than
  // its own cycle length: a run of N consecutive offsets (0,1,...,N-1) on
  // a longer cycle leaves the remaining (cycle.length-N) positions
  // completely uncovered as one contiguous gap, and if that gap happens
  // to swallow an entire shift-block (e.g. a 2-wide Night pair), that
  // shift goes completely uncovered by the base rotation on whichever
  // calendar days line up with it — confirmed directly: 6 B2 staff on the
  // flat 8-day rotation with offsets 0-5 left Night (positions 4,5)
  // completely empty every 8th day, a real regression a fixed step
  // doesn't have a safe universal value for. Spreading N offsets evenly
  // around the FULL cycle (offset_i = round(i * cycle.length / N))
  // instead keeps the largest gap between any two covered positions as
  // small as mathematically possible for that N and cycle.length, so a
  // multi-slot block is never left entirely uncovered on any given day
  // unless genuinely more staff would be needed than the category has.
  const unpatternedCountByCategory = {};
  staff.forEach(s => {
    if (!patternByUser?.[s.id]?.codes?.length) {
      unpatternedCountByCategory[s.category] = (unpatternedCountByCategory[s.category] || 0) + 1;
    }
  });
  const catOffsetCounters = {};

  // Step 1 + 2 + 3 + 4: base rotation, blocked staff, leave overrides, rest-gap.
  staff.forEach((s) => {
    const tail = tailByUser?.[s.id] || ["O", "O", "O"]; // [lastDay, 2ndLast, 3rdLast] of previous month
    // Staff Allocation tab: a staff member assigned a Shift Pattern gets that
    // pattern's own cycle + start-day offset instead of the demand-weighted
    // cycle every unpatterned staff member in their category gets otherwise
    // (see fallbackCycleFor above) — same usePatterns branch reference-ui's
    // applyAutoRoster() has, and everything below (rest-gap pass, coverage
    // pass) is unchanged either way, exactly as in the reference: only how
    // `proposed` is first computed differs.
    const pattern = patternByUser?.[s.id];
    const codes = new Array(nDays);
    const unpatternedTrainingPending = trainingPending.has(s.id) && !pattern?.codes?.length;
    const cycle = pattern?.codes?.length ? pattern.codes : fallbackCycleFor(s.category);
    let offset = 0;
    if (!pattern?.codes?.length) {
      const catIdx = (catOffsetCounters[s.category] = (catOffsetCounters[s.category] || 0) + 1) - 1; // 0,1,2,...
      const catCount = unpatternedCountByCategory[s.category] || 1;
      offset = Math.round((catIdx * cycle.length) / catCount);
    }
    // Only attempted when the caller actually requested continuity
    // (tailByUser present at all — buildContinuationTails is only built
    // when "Continue from Previous Roster" is on) AND this staff member has
    // a real previous-month record to resync from (see resyncCycleStart);
    // null falls straight through to the existing day-anchor formula below.
    const resyncStart = tailByUser ? resyncCycleStart(cycle, tail) : null;

    for (let day = 1; day <= nDays; day++) {
      if (blocked.has(s.id) || unpatternedTrainingPending) { codes[day - 1] = "O"; continue; }
      const onLeaveType = leaveByUserDay?.[s.id]?.get(day);
      if (onLeaveType) { codes[day - 1] = leaveCodeForType(onLeaveType); continue; }

      let proposed = resyncStart !== null
        ? (cycle[(resyncStart + day - 1) % cycle.length] || "O")
        : pattern?.codes?.length
          ? (pattern.codes[(dayAnchor + day - 1 + (pattern.offset || 0)) % pattern.codes.length] || "O")
          : cycle[(dayAnchor + day - 1 + offset) % cycle.length];

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
    if (trainingPending.has(s.id)) return false;
    if (leaveByUserDay?.[s.id]?.has(day)) return false;
    return true;
  }

  // Whether `s` could safely be assigned `shift` on `day`, looking at both
  // the days BEFORE it (their own grid up to day-1, or tailByUser for days
  // 1-3) AND the days after — independent of whatever `s` is currently
  // doing on `day` itself, since same-day redistribution REPLACES that
  // day's assignment rather than adding a second one. Every real
  // DGCA-style rest-gap/night-restriction rule applies exactly as strictly
  // as it would for a fresh assignment.
  //
  // The forward check matters because day+1 (and day+2) may already be
  // fixed from Step 1/the base pattern, computed on the assumption of
  // whatever `day`'s ORIGINAL shift was — redistribution changing `day`
  // can silently invalidate that already-computed future day (e.g. `day`
  // becomes Night while day+1 was already fixed as Afternoon, which is
  // exactly as illegal as a fresh Afternoon-after-Night assignment would
  // be). Re-running the same rules forward, treating `shift` as what
  // day+1 would see as its own "prev", closes that gap.
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

    const next = day < nDays ? grid[s.id][day] : undefined;
    if (next !== undefined) {
      if (isMorn(next) && (isNight(shift, shiftDefsByCode) || isAft(shift))) return false; // day+1 Morning can't follow this Night/Afternoon
      if (isAft(next) && isNight(shift, shiftDefsByCode)) return false; // day+1 Afternoon can't follow this Night
      if (isNight(shift, shiftDefsByCode) && isNight(next, shiftDefsByCode)) {
        // Two Nights in a row (this move's `shift` plus the already-fixed
        // `next`) need BOTH mandatory rest days after them, mirroring Step
        // 1's rule 5 exactly (night, night, O, O) — not just the first.
        // Checking only the first rest day left a real gap: a move could
        // legally create day+1's OFF day while silently leaving day+2 as
        // whatever it happened to already be (a working shift), which is
        // exactly the "2nd mandatory OFF day" the base rotation itself
        // would never have allowed to go missing.
        const next2 = day + 1 < nDays ? grid[s.id][day + 1] : undefined;
        if (next2 !== undefined && next2 !== "O") return false; // 1st mandatory rest day
        const next3 = day + 2 < nDays ? grid[s.id][day + 2] : undefined;
        if (next3 !== undefined && next3 !== "O") return false; // 2nd mandatory rest day
      }
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
    // Matched by shift FAMILY (via shiftFamily/shiftDefsByCode), not literal
    // string equality — a custom code like "M1", "A1"/"A2"/"AS", or a
    // station-defined Night variant ("N1"/"N2"/"N3") must count toward that
    // shift's coverage and be eligible to donate via redistribution exactly
    // like a plain "M"/"A"/"N" would. Previously an exact-match comparison
    // here silently excluded every custom-coded staff member from both
    // sides of this calculation — undercounting real coverage and making
    // them permanently ineligible as donors.
    // Strictly same-category (s.category === category), deliberately NOT
    // creditedCategories — generation never moves anyone across categories
    // on its own, even a dual-qualified staff member genuinely eligible for
    // this one too (see creditedCategories' own comment above). Coverage
    // Analysis still credits a cross-category shift AFTER it happens, if a
    // human deliberately places one; this pass just never creates one.
    shifts.forEach(sh => { bucket[sh] = staff.filter(s => s.category === category && eligibleBase(s, day) && shiftFamily(grid[s.id][day - 1], shiftDefsByCode) === sh); });

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

        // 2) Exigency "flexi" fallback — drawing on an UNLOCKED staff
        // member's OFF day (a pattern-locked staff member's OFF day stays
        // protected even here). For a MANDATORY floor this always applies:
        // the Mandatory Minimum Coverage grid is described everywhere else
        // in this app as a non-negotiable safety floor, so leaving it
        // completely unmet when one off-day pull could have closed the gap
        // is a worse outcome than that pull — confirmed directly with the
        // user. For an ADVISORY shortfall it stays opt-in behind "Patterns
        // + Automatic", exactly as before — ordinary workload-driven
        // understaffing is never, by itself, a reason to touch someone's
        // day off. Either way this candidate still has to pass the exact
        // same eligibility/rest-gap/night-restriction checks a fresh
        // assignment would (eligibleBase, restGapOk) — "last resort" never
        // means "unsafe."
        // Strictly same-category here too (never creditedCategories) — a
        // dual-qualified staff member's day off is never auto-pulled for a
        // DIFFERENT category's gap, confirmed directly with the user: that
        // kind of cross-category pull is a deliberate human call (get real
        // extra headcount, or manually move someone's day off yourself),
        // never something the generator decides on its own. Only the
        // ORIGINAL same-category case below still applies unconditionally
        // for a mandatory floor.
        if (mandatory || allowPatternOverrideForCoverage) {
          const flexiCandidate = staff.find(s => (
            s.category === category && eligibleBase(s, day) && grid[s.id][day - 1] === "O"
            && !lmpmLocked.has(s.id) && restGapOk(s, day, deficitShift)
          ));
          if (flexiCandidate) {
            grid[flexiCandidate.id][day - 1] = deficitShift;
            flexiAssignments.push({ userId: flexiCandidate.id, day, shift: deficitShift, category, mandatory });
            bucket[deficitShift].push(flexiCandidate);
            continue;
          }
        }

        // 3) Genuinely can't be covered — report honestly rather than
        // fabricating coverage or breaking a safety rule. `shortfall` is
        // the actual missing headcount (not just "this combination has a
        // gap"), so a shift short by 3 people is distinguishable from one
        // short by 1 — the earlier version logged one identical-looking
        // entry either way.
        const shortfall = target - bucket[deficitShift].length;
        const target_ = mandatory ? violations : advisoryGaps;
        target_.push({
          day, shift: deficitShift, category, shortfall,
          issue: `${shortfall} ${category} short to cover ${deficitShift} on day ${day} (need ${target}, have ${bucket[deficitShift].length})`,
        });
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

module.exports = { buildRosterAssignments, ROTATION, DEFAULT_MANDATORY_COVERAGE_CONFIG, shiftFamily, creditedCategories, buildCategoryCycle };
