// Pure, DB-free workload-to-manpower calculator. Ported from reference-ui/
// index.html's computeWorkloadPeak() and the Auto-Roster Generator's
// showResults() (renamed runAutoRoster() in the RosterPro PWA build) — this
// is the "how many people do I actually need" planning calculator shown on
// the Generate tab BEFORE a roster is built, distinct from
// rosterGenerationAlgorithm.js's buildRosterAssignments(), which does the
// real day-by-day assignment. Kept separate and pure for the same reason
// that file is: worth testing thoroughly with plain objects, no DB needed.
//
// One quirk preserved deliberately, not fixed: transit workload rows are
// mapped to Morning/Afternoon/Night by ARRAY POSITION (1st row -> Morning,
// 2nd -> Afternoon, 3rd-and-beyond -> Night), exactly as the reference's
// `WL.transit.forEach((r,i)=>{const sh=i===0?'M':i===1?'A':'N';...})` does
// — there is no per-row shift field in the source UI, so a station that
// enters more than 3 transit rows has every row past the 2nd counted
// against Night, same as the original.

function taskConcurrency(freqPerMonth, daysInMon) {
  if (!freqPerMonth || freqPerMonth <= 0) return 0;
  return Math.max(1, Math.ceil(freqPerMonth / daysInMon));
}

function computeWorkloadPeak(workloadItems, daysInMon) {
  const peak = { M: { b1: 0, b2: 0, cm: 0, ncs: 0 }, A: { b1: 0, b2: 0, cm: 0, ncs: 0 }, N: { b1: 0, b2: 0, cm: 0, ncs: 0 } };
  const bySection = { transit: [], nighthalt: [], clash: [], task: [] };
  for (const item of workloadItems) (bySection[item.section] ??= []).push(item);

  bySection.transit.forEach((r, i) => {
    const sh = i === 0 ? "M" : i === 1 ? "A" : "N";
    if (r.count > 0) { peak[sh].b1 += r.b1; peak[sh].b2 += r.b2; peak[sh].cm += r.cm; peak[sh].ncs += r.ncs; }
  });
  bySection.clash.forEach(r => {
    if (r.count > 0) { peak.M.b1 += r.b1; peak.M.b2 += r.b2; peak.M.cm += r.cm; peak.M.ncs += r.ncs; }
  });
  bySection.nighthalt.forEach(r => {
    const c = taskConcurrency(r.count, daysInMon);
    if (c > 0) { peak.N.b1 += r.b1 * c; peak.N.b2 += r.b2 * c; peak.N.cm += r.cm * c; peak.N.ncs += r.ncs * c; }
  });
  bySection.task.forEach(r => {
    const c = taskConcurrency(r.count, daysInMon);
    if (c > 0) { peak.A.b1 += r.b1 * c; peak.A.b2 += r.b2 * c; peak.A.cm += r.cm * c; peak.A.ncs += r.ncs * c; }
  });

  // Hard minimums: at least 1 B1 AME on every shift, at least 1 B2 AME at night.
  ["M", "A", "N"].forEach(sh => { peak[sh].b1 = Math.max(peak[sh].b1, 1); });
  peak.N.b2 = Math.max(peak.N.b2, 1);
  return peak;
}

// staffByCategory: { B1: <active, non-blocked count>, B2: ..., CM: ..., NCS: ..., STO: ... }
function computeManpowerPlan({ workloadItems, daysInMon, aogBuffer, staffByCategory, totalStaff, blockedCount }) {
  const peak = computeWorkloadPeak(workloadItems, daysInMon);
  const aogPerShift = Math.ceil((aogBuffer || 0) / 3);

  const tgt = {};
  for (const sh of ["M", "A", "N"]) {
    tgt[sh] = Math.max(1, Math.ceil(peak[sh].b1 + peak[sh].b2 + peak[sh].cm + peak[sh].ncs)) + aogPerShift;
  }
  const grandNeeded = tgt.M + tgt.A + tgt.N;
  const effectiveStaff = Math.max(0, (totalStaff || 0) - (blockedCount || 0));

  const CAT_KEY = { B1: "b1", B2: "b2", CM: "cm", NCS: "ncs", STO: null };
  const categoryRequirement = Object.entries(CAT_KEY).map(([cat, key]) => {
    const needs = { M: 0, A: 0, N: 0 };
    if (key) for (const sh of ["M", "A", "N"]) needs[sh] = Math.max(0, peak[sh][key]);
    const available = staffByCategory?.[cat] || 0;
    const maxNeed = Math.max(needs.M, needs.A, needs.N, 0);
    return { category: cat, needs, available, status: available >= maxNeed ? "OK" : "SHORT" };
  });

  // Transit, then Night Halt, then Clash, then Task — the reference's own
  // display order (built by concatenating its WL.transit/nighthalt/clash/
  // task arrays in that order), not alphabetical by section name.
  const SECTION_DISPLAY_ORDER = { transit: 0, nighthalt: 1, clash: 2, task: 3 };
  const workloadSummary = workloadItems
    .filter(r => r.count > 0)
    .map(r => ({ section: r.section, label: r.label, count: r.count, b1: r.b1, b2: r.b2, cm: r.cm, ncs: r.ncs }))
    .sort((a, b) => (SECTION_DISPLAY_ORDER[a.section] ?? 99) - (SECTION_DISPLAY_ORDER[b.section] ?? 99));

  return {
    peak, target: tgt, grandNeeded, effectiveStaff, aogPerShift,
    sufficient: effectiveStaff >= grandNeeded,
    shortfall: Math.max(0, grandNeeded - effectiveStaff),
    categoryRequirement, workloadSummary,
  };
}

module.exports = { taskConcurrency, computeWorkloadPeak, computeManpowerPlan };
