// Coverage Analysis — reads an ALREADY-GENERATED roster for a station/month
// and compares what actually got scheduled against the station's configured
// Mandatory Minimum Coverage floors, per category and shift. Distinct from
// rosterPlanningService.getManpowerPlan (a PRE-generation planning estimate
// built from flight schedule/task-master demand): this looks at the real,
// already-committed roster and explains, day by day, where it's short and
// why — including whether the shortfall is a one-off rotation quirk or a
// structural headcount shortage no amount of rescheduling can fix.
const rosterRepo = require("../repositories/rosterRepository");
const leaveRepo = require("../repositories/leaveRepository");
const workloadConfigService = require("./workloadConfigService");
const { shiftFamily } = require("../utils/rosterGenerationAlgorithm");

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function dateAt(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function shiftLabel(sh) { return sh === "M" ? "Morning" : sh === "A" ? "Afternoon" : "Night"; }

const CATEGORIES = ["B1", "B2", "CM", "NCS"];

async function getCoverageAnalysis(stationId, monthKey) {
  const roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  if (!roster) {
    return {
      stationId, monthKey, generated: false,
      message: `No roster has been generated yet for ${monthKey} — generate one first (Auto Generate or Shift Roster), then run this analysis.`,
    };
  }

  const nDays = daysInMonth(monthKey);
  const monthStart = dateAt(monthKey, 1);
  const monthEnd = dateAt(monthKey, nDays);

  const [staff, mandatoryRules] = await Promise.all([
    rosterRepo.getRosterGrid(stationId, roster.id),
    workloadConfigService.listMandatoryCoverageRules(stationId),
  ]);
  const leaves = await leaveRepo.approvedLeaveForStaffInRange(staff.map(s => s.id), monthStart, monthEnd);

  // Built from the roster's OWN assignments — the real shift types this
  // station actually uses — so a custom code (M1/N2/AS/...) classifies by
  // its real type instead of only the hardcoded M/A/N letters, same as
  // every other shiftFamily() caller in this app.
  const shiftDefsByCode = {};
  staff.forEach(s => s.shiftAssignments.forEach(sa => { shiftDefsByCode[sa.shiftDef.code] = sa.shiftDef.type; }));

  // Per-day, per-category, per-shift-family ACTUAL headcount, straight from
  // the real generated roster — never a hypothetical re-derivation.
  const coverage = {};
  const key = (d, c, sh) => `${d}|${c}|${sh}`;
  for (let d = 1; d <= nDays; d++) {
    const dateStr = dateAt(monthKey, d).toISOString().slice(0, 10);
    for (const s of staff) {
      if (!CATEGORIES.includes(s.category)) continue; // STO and anyone uncategorized sit outside the mandatory-coverage system entirely
      const sa = s.shiftAssignments.find(a => new Date(a.shiftDate).toISOString().slice(0, 10) === dateStr);
      const code = sa?.shiftDef?.code;
      if (!code) continue;
      const fam = shiftFamily(code, shiftDefsByCode);
      if (!fam) continue;
      const k = key(d, s.category, fam);
      coverage[k] = (coverage[k] || 0) + 1;
    }
  }

  // Leave-day accounting per staff member, clipped to this month — used
  // to tell "on leave the whole month" (genuinely shrinks the category)
  // apart from an ordinary few-day absence the rotation already expects.
  const leaveDaysByUser = {};
  leaves.forEach(l => {
    const from = l.fromDate < monthStart ? monthStart : l.fromDate;
    const to = l.toDate > monthEnd ? monthEnd : l.toDate;
    const days = Math.round((to - from) / 86400000) + 1;
    leaveDaysByUser[l.userId] = (leaveDaysByUser[l.userId] || 0) + Math.max(0, days);
  });

  const headcountByCategory = {};
  CATEGORIES.forEach(cat => {
    const members = staff.filter(s => s.category === cat);
    const fullMonthLeave = members.filter(s => (leaveDaysByUser[s.id] || 0) >= nDays);
    const onLeaveAnyDay = members.filter(s => (leaveDaysByUser[s.id] || 0) > 0);
    headcountByCategory[cat] = {
      total: members.length,
      activeEffective: members.length - fullMonthLeave.length,
      fullMonthLeave: fullMonthLeave.map(s => s.fullName),
      onLeaveAnyDay: onLeaveAnyDay.map(s => ({ name: s.fullName, days: leaveDaysByUser[s.id] })),
    };
  });

  // One row per ENABLED category/shift floor — a combination nobody
  // configured as mandatory has nothing meaningful to be "short" against.
  const rows = [];
  mandatoryRules.filter(r => r.enabled).forEach(r => {
    const vals = [];
    const gapDays = [];
    for (let d = 1; d <= nDays; d++) {
      const actual = coverage[key(d, r.category, r.shift)] || 0;
      vals.push(actual);
      if (actual < r.minCount) gapDays.push({ day: d, actual, floor: r.minCount, shortfall: r.minCount - actual });
    }
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
    const active = headcountByCategory[r.category].activeEffective;
    // Heuristic, not a scheduling promise: the flat 8-day base rotation
    // (M,M,A,A,N,N,O,O) puts any one unpatterned person on a given shift
    // family 2 of every 8 days, so N active staff sustain roughly N/4
    // average presence per shift — a quick way to tell "not enough people
    // exist to ever meet this floor" apart from "enough people exist but
    // today's particular rest-day clustering got unlucky."
    const sustainableAvg = Math.round((active / 4) * 100) / 100;
    let suggestion = null;
    if (gapDays.length > 0) {
      if (sustainableAvg < r.minCount) {
        const neededActive = Math.ceil(r.minCount * 4);
        suggestion = `Structural shortage: ${active} active ${r.category} staff sustain only ~${sustainableAvg}/shift on average under the standard rotation, against a floor of ${r.minCount}. Consider growing ${r.category} headcount to roughly ${neededActive} active staff (or lowering this floor) to reliably meet it every ${shiftLabel(r.shift)}.`;
      } else {
        suggestion = `Headcount looks theoretically sufficient (~${sustainableAvg}/shift on average), but ${gapDays.length} day(s) still fall short — most likely rotation clustering (everyone who could help that day is either resting or already locked into an adjacent shift). Consider enabling "Patterns + Automatic" in Auto Generate, or adding 1 more active ${r.category} as a safety margin.`;
      }
    }
    rows.push({ category: r.category, shift: r.shift, floor: r.minCount, min, max, avg, gapDaysCount: gapDays.length, gapDays, suggestion });
  });

  const notes = [];
  CATEGORIES.forEach(cat => {
    const h = headcountByCategory[cat];
    if (h.fullMonthLeave.length > 0) {
      notes.push(`${h.fullMonthLeave.length} ${cat} staff member(s) on leave for all of ${monthKey} (${h.fullMonthLeave.join(", ")}) — effective ${cat} headcount this month is ${h.activeEffective} of ${h.total}.`);
    }
  });

  return {
    stationId, monthKey, generated: true, nDays,
    isPublished: roster.isPublished,
    headcountByCategory, rows, notes,
  };
}

module.exports = { getCoverageAnalysis };
