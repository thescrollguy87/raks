// Ported verbatim from the RosterPro PWA (RosterProPWA9.zip)'s Rule Builder
// engine. `staff` here is [{ id, category, shifts: [codes...] }] and
// `shiftDefsByCode` maps a code -> { type, start, end } (type is one of
// duty|night|off|leave|other) — the same shape buildRosterAssignments
// already threads through the codebase.

// Resolves a rule's "applies to" into the actual subset of staff it covers
// — rules were previously stored with an appliesTo LABEL but nothing ever
// filtered by it, so every rule silently applied to everyone regardless of
// what it claimed.
function resolveRuleStaffScope(rule, staffList, staffGroupMembersByGroupId) {
  if (rule.appliesToType === "category") return staffList.filter(s => s.category === rule.appliesToValue);
  if (rule.appliesToType === "group") {
    const memberIds = staffGroupMembersByGroupId?.[rule.appliesToValue];
    if (!memberIds) return [];
    return staffList.filter(s => memberIds.includes(s.id));
  }
  if (rule.appliesToType === "staff") return staffList.filter(s => s.id === rule.appliesToValue);
  return staffList; // "all"
}

function ruleAppliesToStaff(rule, s, staffGroupMembersByGroupId) {
  if (rule.appliesToType === "category") return s.category === rule.appliesToValue;
  if (rule.appliesToType === "group") {
    const memberIds = staffGroupMembersByGroupId?.[rule.appliesToValue];
    return !!memberIds && memberIds.includes(s.id);
  }
  if (rule.appliesToType === "staff") return s.id === rule.appliesToValue;
  return true; // "all"
}

function appliesToLabel(rule, staffGroupNameById) {
  if (rule.appliesToType === "category") return `Category: ${rule.appliesToValue}`;
  if (rule.appliesToType === "group") return `Group: ${staffGroupNameById?.[rule.appliesToValue] || "(deleted group)"}`;
  if (rule.appliesToType === "staff") return `Staff: ${rule.appliesToValue}`;
  return "All Staff";
}

const MORN_CODES = new Set(["M", "M1", "MS"]);
const AFT_CODES = new Set(["A", "A1", "A2", "AS"]);
function shiftType(code, shiftDefsByCode) { return shiftDefsByCode?.[code]?.type || (code === "O" ? "off" : "duty"); }
function isNight(code, shiftDefsByCode) { return shiftType(code, shiftDefsByCode) === "night"; }
function isMorn(code) { return MORN_CODES.has(code); }
function netHrs(code, shiftDefsByCode) {
  const def = shiftDefsByCode?.[code];
  if (!def || !def.start || !def.end) return 0;
  const [sh, sm] = def.start.split(":").map(Number);
  const [eh, em] = def.end.split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.max(0, (mins - (def.breakMin || 0)) / 60);
}

function checkMaxConsecutiveNights(s, nDays, maxNights, rule, shiftDefsByCode, violations, label) {
  let consecutive = 0;
  for (let d = 0; d < nDays; d++) {
    if (isNight(s.shifts[d], shiftDefsByCode)) {
      consecutive++;
      if (consecutive > maxNights) violations.push({ staff: s.id, day: d + 1, shift: s.shifts[d], rule: rule.name, severity: "critical", reason: `${consecutive} consecutive nights exceeds the configured limit of ${maxNights} (${label})` });
    } else consecutive = 0;
  }
}
function checkRestAfterNight(s, nDays, rule, shiftDefsByCode, violations, label) {
  for (let d = 1; d < nDays; d++) {
    if (isNight(s.shifts[d - 1], shiftDefsByCode) && isMorn(s.shifts[d])) {
      violations.push({ staff: s.id, day: d + 1, shift: s.shifts[d], rule: rule.name, severity: "critical", reason: `Morning shift scheduled the day immediately after a Night shift (${label})` });
    }
  }
}
function checkMinRestHours(s, nDays, minHours, rule, shiftDefsByCode, violations, label) {
  for (let d = 1; d < nDays; d++) {
    const prevCode = s.shifts[d - 1], curCode = s.shifts[d];
    const prevDef = shiftDefsByCode?.[prevCode], curDef = shiftDefsByCode?.[curCode];
    if (!prevDef?.start || !prevDef?.end || !curDef?.start || !curDef?.end) continue;
    const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const prevStartAbs = (d - 1) * 1440 + toMin(prevDef.start);
    let prevEndAbs = (d - 1) * 1440 + toMin(prevDef.end);
    if (prevEndAbs <= prevStartAbs) prevEndAbs += 1440;
    const curStartAbs = d * 1440 + toMin(curDef.start);
    const restHours = (curStartAbs - prevEndAbs) / 60;
    if (restHours < minHours) {
      violations.push({ staff: s.id, day: d + 1, shift: curCode, rule: rule.name, severity: "critical", reason: `Only ${restHours.toFixed(1)}h rest between ${prevCode} and ${curCode} — below the configured minimum of ${minHours}h (${label})` });
    }
  }
}
function checkForcedOffAfterNights(s, nDays, nightsThreshold, offDaysRequired, rule, shiftDefsByCode, violations, label) {
  let consecutive = 0;
  for (let d = 0; d < nDays; d++) {
    if (isNight(s.shifts[d], shiftDefsByCode)) {
      consecutive++;
    } else {
      if (consecutive >= nightsThreshold) {
        let offCount = 0;
        for (let k = d; k < Math.min(nDays, d + offDaysRequired); k++) { if (shiftType(s.shifts[k], shiftDefsByCode) === "off") offCount++; }
        if (offCount < offDaysRequired) {
          violations.push({ staff: s.id, day: d, shift: s.shifts[d - 1], rule: rule.name, severity: "critical", reason: `After ${consecutive} consecutive nights, only ${offCount} of the required ${offDaysRequired} OFF day(s) followed (${label})` });
        }
      }
      consecutive = 0;
    }
  }
}
function checkMaxWeeklyHours(s, nDays, maxHours, rule, shiftDefsByCode, violations, label) {
  for (let start = 0; start <= nDays - 7; start++) {
    let hours = 0;
    for (let k = start; k < start + 7; k++) hours += netHrs(s.shifts[k], shiftDefsByCode);
    if (hours > maxHours) {
      violations.push({ staff: s.id, day: start + 1, shift: "—", rule: rule.name, severity: "critical", reason: `${hours.toFixed(1)}h worked in the 7-day window starting day ${start + 1} exceeds the configured limit of ${maxHours}h (${label})` });
    }
  }
}
function checkMaxMonthlyHours(s, nDays, maxHours, rule, shiftDefsByCode, violations, label) {
  let hours = 0;
  for (let d = 0; d < nDays; d++) hours += netHrs(s.shifts[d], shiftDefsByCode);
  if (hours > maxHours) {
    violations.push({ staff: s.id, day: nDays, shift: "—", rule: rule.name, severity: "critical", reason: `${hours.toFixed(1)}h total this month exceeds the configured limit of ${maxHours}h (${label})` });
  }
}
function checkNightOnly(s, nDays, rule, shiftDefsByCode, violations, label) {
  for (let d = 0; d < nDays; d++) {
    if (shiftType(s.shifts[d], shiftDefsByCode) === "duty") {
      violations.push({ staff: s.id, day: d + 1, shift: s.shifts[d], rule: rule.name, severity: "critical", reason: `Assigned a non-Night duty shift (${s.shifts[d]}) — configured as Night-only (${label})` });
    }
  }
}
function checkNoNight(s, nDays, rule, shiftDefsByCode, violations, label) {
  for (let d = 0; d < nDays; d++) {
    if (isNight(s.shifts[d], shiftDefsByCode)) {
      violations.push({ staff: s.id, day: d + 1, shift: s.shifts[d], rule: rule.name, severity: "critical", reason: `Assigned a Night shift (${s.shifts[d]}) — configured as No-Night (${label})` });
    }
  }
}

// Hard-rule compliance check run AFTER generation. Each enabled hard rule
// is resolved to its actual staff scope and dispatched to the matching
// checker — a rule scoped to "Category: B2" now genuinely only checks B2
// staff, not the whole roster.
function checkHardRuleCompliance(rules, staff, nDays, shiftDefsByCode, staffGroupMembersByGroupId, staffGroupNameById) {
  const violations = [];
  const enabledRules = rules.filter(r => r.enabled && r.type === "hard" && r.conditionType && r.conditionType !== "informational");
  enabledRules.forEach(rule => {
    const scoped = resolveRuleStaffScope(rule, staff, staffGroupMembersByGroupId);
    const label = appliesToLabel(rule, staffGroupNameById);
    scoped.forEach(s => {
      switch (rule.conditionType) {
        case "max_consecutive_nights": checkMaxConsecutiveNights(s, nDays, +rule.limitValue || 2, rule, shiftDefsByCode, violations, label); break;
        case "rest_after_night": checkRestAfterNight(s, nDays, rule, shiftDefsByCode, violations, label); break;
        case "min_rest_hours": checkMinRestHours(s, nDays, +rule.limitValue || 11, rule, shiftDefsByCode, violations, label); break;
        case "forced_off_after_nights": checkForcedOffAfterNights(s, nDays, +rule.limitValue || 2, +rule.offDays || 2, rule, shiftDefsByCode, violations, label); break;
        case "max_weekly_hours": checkMaxWeeklyHours(s, nDays, +rule.limitValue || 48, rule, shiftDefsByCode, violations, label); break;
        case "max_monthly_hours": checkMaxMonthlyHours(s, nDays, +rule.limitValue || 190, rule, shiftDefsByCode, violations, label); break;
        case "night_only": checkNightOnly(s, nDays, rule, shiftDefsByCode, violations, label); break;
        case "no_night": checkNoNight(s, nDays, rule, shiftDefsByCode, violations, label); break;
      }
    });
  });
  return violations;
}

// Soft-rule optimization scoring. Coefficient-of-variation (stdev ÷ mean):
// CV=0 means everyone in the group has identical hours/nights (score 100);
// a CV of 0.5 scores 0.
function cvToScore(cv) { return Math.max(0, Math.min(100, Math.round(100 - cv * 200))); }

function computeHoursBalanceScore(nDays, scopedStaff, shiftDefsByCode) {
  const byCat = {};
  scopedStaff.forEach(s => {
    let hours = 0;
    for (let d = 0; d < nDays; d++) hours += netHrs(s.shifts[d], shiftDefsByCode);
    (byCat[s.category] = byCat[s.category] || []).push(hours);
  });
  const catScores = [];
  Object.entries(byCat).forEach(([cat, arr]) => {
    if (arr.length < 2) return;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (mean === 0) return;
    const stdev = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
    catScores.push({ cat, score: cvToScore(stdev / mean), meanHours: Math.round(mean * 10) / 10, stdevHours: Math.round(stdev * 10) / 10, staffCount: arr.length });
  });
  const overall = catScores.length ? Math.round(catScores.reduce((a, c) => a + c.score, 0) / catScores.length) : null;
  return { overall, catScores };
}

// Scoped to staff NOT locked to a fixed pattern when patterns are in use —
// a pattern dictates someone's night frequency by design, so comparing
// their night count against someone on a day-only pattern isn't a
// fairness gap to fix.
function computeNightBalanceScore(nDays, scopedStaff, usePatterns, isPatternLocked, shiftDefsByCode) {
  const eligible = usePatterns ? scopedStaff.filter(s => !isPatternLocked(s)) : scopedStaff;
  const byCat = {};
  eligible.forEach(s => {
    let nights = 0;
    for (let d = 0; d < nDays; d++) if (isNight(s.shifts[d], shiftDefsByCode)) nights++;
    (byCat[s.category] = byCat[s.category] || []).push(nights);
  });
  const catScores = [];
  Object.entries(byCat).forEach(([cat, arr]) => {
    if (arr.length < 2) return;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (mean === 0) return;
    const stdev = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
    catScores.push({ cat, score: cvToScore(stdev / mean), meanNights: Math.round(mean * 10) / 10, stdevNights: Math.round(stdev * 10) / 10, staffCount: arr.length });
  });
  const overall = catScores.length ? Math.round(catScores.reduce((a, c) => a + c.score, 0) / catScores.length) : null;
  return { overall, catScores };
}

function computeSoftRuleScore(rules, staff, nDays, usePatterns, isPatternLocked, shiftDefsByCode, staffGroupMembersByGroupId, staffGroupNameById) {
  const results = [];
  const softRules = rules.filter(r => r.enabled && r.type === "soft" && (r.conditionType === "balance_total_hours" || r.conditionType === "balance_night_duties"));
  softRules.forEach(rule => {
    const scoped = resolveRuleStaffScope(rule, staff, staffGroupMembersByGroupId);
    const label = appliesToLabel(rule, staffGroupNameById);
    if (rule.conditionType === "balance_total_hours") {
      const r = computeHoursBalanceScore(nDays, scoped, shiftDefsByCode);
      if (r.overall !== null) results.push({ ruleName: rule.name, metric: "Hours Balance", score: r.overall, catScores: r.catScores, appliesTo: label });
    } else if (rule.conditionType === "balance_night_duties") {
      const r = computeNightBalanceScore(nDays, scoped, usePatterns, isPatternLocked, shiftDefsByCode);
      if (r.overall !== null) results.push({ ruleName: rule.name, metric: "Night Duty Balance", score: r.overall, catScores: r.catScores, appliesTo: label });
    }
  });
  const overallScore = results.length ? Math.round(results.reduce((a, r) => a + r.score, 0) / results.length) : null;
  return { overallScore, results };
}

module.exports = {
  resolveRuleStaffScope, ruleAppliesToStaff, appliesToLabel,
  checkHardRuleCompliance, cvToScore, computeHoursBalanceScore, computeNightBalanceScore, computeSoftRuleScore,
};
