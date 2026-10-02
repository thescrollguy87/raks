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
const stationRepo = require("../repositories/stationRepository");
const workloadConfigService = require("./workloadConfigService");
const ApiError = require("../utils/ApiError");
const { shiftFamily } = require("../utils/rosterGenerationAlgorithm");
const { shiftNetHours } = require("../utils/shiftHours");

const MANHOURS_CATEGORIES = ["B1", "B2", "CM", "NCS"];

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
      const sa = s.shiftAssignments.find(a => new Date(a.shiftDate).toISOString().slice(0, 10) === dateStr);
      const code = sa?.shiftDef?.code;
      if (!code) continue;
      const fam = shiftFamily(code, shiftDefsByCode);
      if (!fam) continue;
      // Credit this shift toward EVERY category the staff member is
      // qualified for that this floor system tracks — their primary
      // category, plus any secondaryCategories a station has flagged them
      // for (e.g. a B1-licensed Station I/C who's also CM-certified,
      // genuinely covering a CM gap). A real dual-qualified person on duty
      // satisfies both floors at once; STO and anyone with no category sit
      // outside the mandatory-coverage system entirely either way.
      const creditedCategories = [s.category, ...(s.secondaryCategories || [])].filter(c => CATEGORIES.includes(c));
      new Set(creditedCategories).forEach(c => {
        const k = key(d, c, fam);
        coverage[k] = (coverage[k] || 0) + 1;
      });
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

// Manhours Available vs Expected — shown on the Dashboard once a roster has
// been generated/published, and during Auto Generate's preview step (that
// path computes "available" from the in-memory just-generated assignments
// directly, via generateRoster's own `manhours` field — see
// rosterGenerationService.js). This function is the DASHBOARD side: it
// recomputes BOTH sides fresh on every call, straight from whatever the
// roster and workload config currently are, so a manual edit + republish
// (or a Workload Config change) is reflected the moment this is read again
// — nothing here is cached at generation time.
//
// "Expected" = the real demand (flight-schedule concurrency, Task Master,
// Mandatory Minimum floor, manual demand, buffer — the same
// computeDailyShiftDemand result generation itself uses) converted to
// hours. "Available" = actual net duty hours from the roster's real
// ShiftAssignment rows, including any per-day in1/out1/in2/out2 override a
// manual edit may have set — unlike the Auto Generate preview path (which
// has no such overrides to apply yet, since nothing's been hand-edited).
async function getManhoursSummary(stationId, monthKey) {
  const rosterGenerationService = require("./rosterGenerationService"); // lazy require — avoids a load-order cycle, same pattern rosterPlanningService.js already uses
  const station = await stationRepo.findStationAirlineId(stationId);
  if (!station) throw ApiError.notFound("Station not found");

  const [roster, workloadContext] = await Promise.all([
    rosterRepo.findRosterByStationAndMonth(stationId, monthKey),
    rosterGenerationService.buildWorkloadContext(stationId, monthKey, undefined, 0, station.airlineId),
  ]);
  const expected = workloadContext.expectedManhours;

  if (!roster) {
    return {
      stationId, monthKey, generated: false,
      message: `No roster has been generated yet for ${monthKey} — expected man-hours are shown from the current workload configuration; available man-hours will appear once a roster exists.`,
      expected, available: null,
    };
  }

  const staff = await rosterRepo.getRosterGrid(stationId, roster.id);
  const available = { total: 0, byCategory: { B1: 0, B2: 0, CM: 0, NCS: 0 } };
  staff.forEach(s => {
    if (!MANHOURS_CATEGORIES.includes(s.category)) return;
    s.shiftAssignments.forEach(sa => {
      const def = sa.shiftDef;
      if (!def || (def.type !== "duty" && def.type !== "night")) return;
      const hrs = shiftNetHours(def, sa);
      available.byCategory[s.category] += hrs;
      available.total += hrs;
    });
  });
  const round1 = n => Math.round(n * 10) / 10;
  available.total = round1(available.total);
  MANHOURS_CATEGORIES.forEach(cat => { available.byCategory[cat] = round1(available.byCategory[cat]); });

  const byCategory = {};
  MANHOURS_CATEGORIES.forEach(cat => {
    const exp = expected.byCategory[cat] || 0;
    const avail = available.byCategory[cat] || 0;
    byCategory[cat] = { expected: exp, available: avail, utilizationPct: exp > 0 ? Math.round((avail / exp) * 100) : null };
  });

  return {
    stationId, monthKey, generated: true, isPublished: roster.isPublished,
    total: { expected: expected.total, available: available.total },
    byCategory,
  };
}

module.exports = { getCoverageAnalysis, getManhoursSummary };
