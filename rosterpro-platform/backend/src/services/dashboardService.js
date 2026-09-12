const rosterRepo = require("../repositories/rosterRepository");
const complianceRepo = require("../repositories/complianceRepository");
const flightRepo = require("../repositories/flightRepository");
const userRepo = require("../repositories/userRepository");
const stationRepo = require("../repositories/stationRepository");
const complianceService = require("./complianceService");
const leaveService = require("./leaveService");
const flightScheduleService = require("./flightScheduleService");
const ApiError = require("../utils/ApiError");
const { isAirlineWide } = require("../utils/stationScope");
const { shiftFamily } = require("../utils/rosterGenerationAlgorithm");

// ── 1. Qualification expiry ──────────────────────────────────────────────

async function qualificationExpiryWidget(stationId, windowDays = 30) {
  const [quals, licenses, authorizations] = await Promise.all([
    complianceRepo.qualification.listExpiringWithin(windowDays, { stationId }),
    complianceRepo.license.listExpiringWithin(windowDays, { stationId }),
    complianceRepo.authorization.listExpiringWithin(windowDays, { stationId }),
  ]);

  const now = new Date();
  const countByStatus = (items) => ({
    expired: items.filter(i => i.expiryDate < now).length,
    expiring: items.filter(i => i.expiryDate >= now).length,
  });

  return {
    qualifications: { ...countByStatus(quals), items: quals },
    licenses: { ...countByStatus(licenses), items: licenses },
    // An expired authorization blocks full-scope duty the same way an
    // expired qualification/license does (see complianceService.
    // getComplianceSummary) — it belongs in the same expiry picture, not
    // a separate one a caller could forget to check.
    authorizations: { ...countByStatus(authorizations), items: authorizations },
    windowDays,
  };
}

// ── 2. Leave balance ──────────────────────────────────────────────────────

async function leaveBalanceWidget(stationId, year) {
  const staff = await rosterRepo.getActiveStaffContacts(stationId);
  const balances = await Promise.all(staff.map(async (s) => {
    const { balance } = await leaveService.getBalance(s.id, year);
    return { userId: s.id, fullName: s.fullName, balance };
  }));

  // Station-wide utilization: total ANNUAL days taken vs total entitlement,
  // the single number a manager actually wants at a glance.
  const totalEntitlement = balances.reduce((sum, b) => sum + (b.balance.ANNUAL?.entitlement || 0), 0);
  const totalTaken = balances.reduce((sum, b) => sum + (b.balance.ANNUAL?.taken || 0), 0);

  return {
    year, staffCount: staff.length, balances,
    annualUtilization: totalEntitlement > 0 ? Math.round((totalTaken / totalEntitlement) * 100) : 0,
  };
}

// ── 3. Roster coverage ────────────────────────────────────────────────────

// Applies the same minimum-coverage rule the roster generator enforces (at
// least 1 B1 AME on every shift, at least 1 B2 AME at night) and reports
// which days actually violate it — this is the "did the roster we published
// actually meet the rule, not just did the generator try to" check.
async function rosterCoverageWidget(stationId, monthKey) {
  const roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  if (!roster) throw ApiError.notFound(`No roster exists yet for ${monthKey}`);

  const staff = await rosterRepo.getRosterGrid(stationId, roster.id);
  const byDate = {}; // dateStr -> { M: {B1,B2}, A: {...}, N: {...} }

  for (const s of staff) {
    for (const sa of s.shiftAssignments) {
      if (sa.shiftDef.type !== "duty" && sa.shiftDef.type !== "night") continue;
      // Morning/Afternoon variant codes (M1, MS, AS, ...) fold into the same
      // M/A bucket as the plain code — a B1 on "M1" fulfills the Morning
      // requirement same as one on "M". General/Break/Flexi-type codes
      // (shiftFamily returns null) need no mandatory coverage check at all,
      // same as the roster generator's own coverage pass.
      const shiftKey = shiftFamily(sa.shiftDef.code, sa.shiftDef.type);
      if (!shiftKey) continue;
      const dateStr = new Date(sa.shiftDate).toISOString().slice(0, 10);
      byDate[dateStr] ??= {};
      byDate[dateStr][shiftKey] ??= { B1: 0, B2: 0, total: 0 };
      byDate[dateStr][shiftKey].total++;
      if (s.category === "B1") byDate[dateStr][shiftKey].B1++;
      if (s.category === "B2") byDate[dateStr][shiftKey].B2++;
    }
  }

  const violations = [];
  for (const [dateStr, shifts] of Object.entries(byDate)) {
    for (const [shiftKey, counts] of Object.entries(shifts)) {
      if (counts.B1 === 0) violations.push({ date: dateStr, shift: shiftKey, issue: "No B1 AME assigned", severity: "critical" });
      if (shiftKey === "N" && counts.B2 === 0) violations.push({ date: dateStr, shift: shiftKey, issue: "No B2 AME assigned on Night", severity: "warning" });
    }
  }

  const updatedBy = roster.updatedById ? await userRepo.findById(roster.updatedById) : null;

  return {
    monthKey, isPublished: roster.isPublished,
    daysWithData: Object.keys(byDate).length,
    violationCount: violations.length,
    criticalCount: violations.filter(v => v.severity === "critical").length,
    violations,
    dailyBreakdown: byDate,
    // Roster Status card fields — real columns already on the Roster row,
    // just not previously surfaced to the dashboard.
    createdAt: roster.createdAt, updatedAt: roster.updatedAt,
    updatedByName: updatedBy?.fullName || null,
  };
}

// ── 4. Flight coverage ───────────────────────────────────────────────────

async function flightCoverageWidget(stationId, from, to) {
  const [flights, delays] = await Promise.all([
    flightRepo.listFlightsForStation(stationId, new Date(from), new Date(to)),
    flightRepo.listDelaysForStation(stationId, new Date(from), new Date(to)),
  ]);

  const totalDelayMinutes = delays.reduce((sum, d) => sum + d.minutes, 0);
  const flightsWithDelay = new Set(delays.map(d => d.flightId)).size;

  // "Total Flights" reflects the real Flight Schedule (Turn Report +
  // Charter import) a station actually uses to plan departure manpower —
  // not the separate ad-hoc Flight/Engineering-Delay log below (on-time
  // rate, delay minutes), which nothing in the app currently bulk-imports
  // into and is realistically always empty. `from`/`to` are always a single
  // calendar month's start/end here (both callers below construct them that
  // way), so the month they fall in is the schedule month to look up.
  const fromDate = new Date(from);
  const scheduleYear = fromDate.getUTCFullYear();
  const scheduleMonth = fromDate.getUTCMonth() + 1;
  const schedule = await flightScheduleService
    .getFlightScheduleView(stationId, scheduleYear, scheduleMonth)
    .catch(() => null);
  const totalFlights = schedule?.imported ? schedule.summary.totalMovements : flights.length;

  return {
    from, to,
    totalFlights,
    delayedFlights: flightsWithDelay,
    onTimeRate: flights.length > 0 ? Math.round(((flights.length - flightsWithDelay) / flights.length) * 100) : 100,
    totalEngineeringDelayMinutes: totalDelayMinutes,
    delayCount: delays.length,
  };
}

// ── 5. DGCA compliance ────────────────────────────────────────────────────

// The single "are we audit-ready right now" number — how many active staff
// currently have an expired qualification or license and would be blocked
// from being rostered for full-scope duty.
async function dgcaComplianceWidget(stationId) {
  const staff = await rosterRepo.getActiveStaffContacts(stationId);
  const summaries = await Promise.all(staff.map(s => complianceService.getComplianceSummary(s.id)));

  // Real reasons, not just a name — every expired qualification/license/
  // authorization that caused the block (same three record types
  // complianceService.getComplianceSummary itself checks), so a caller can
  // show what's actually wrong instead of just "blocked".
  const blockedStaff = staff
    .map((s, i) => {
      const sum = summaries[i];
      if (!sum.isBlocked) return null;
      const reasons = [
        ...sum.qualifications.filter(q => q.status === "EXPIRED").map(q => `Qualification ${q.qualCode} expired`),
        ...sum.licenses.filter(l => l.status === "EXPIRED").map(l => `License ${l.licenseNo} (${l.category}) expired`),
        ...sum.authorizations.filter(a => a.status === "EXPIRED").map(a => `Authorization ${a.scope} expired`),
      ];
      return { id: s.id, fullName: s.fullName, reasons };
    })
    .filter(Boolean);

  return {
    totalActiveStaff: staff.length,
    blockedStaffCount: blockedStaff.length,
    blockedStaff,
    complianceRate: staff.length > 0 ? Math.round(((staff.length - blockedStaff.length) / staff.length) * 100) : 100,
  };
}

// ── 6. Staff workload ─────────────────────────────────────────────────────

async function staffWorkloadWidget(stationId, monthKey) {
  const roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  if (!roster) throw ApiError.notFound(`No roster exists yet for ${monthKey}`);

  const staff = await rosterRepo.getRosterGrid(stationId, roster.id);
  const workload = staff.map(s => {
    const dutyDays = s.shiftAssignments.filter(sa => sa.shiftDef.type === "duty").length;
    const nightDays = s.shiftAssignments.filter(sa => sa.shiftDef.type === "night").length;
    const leaveDays = s.shiftAssignments.filter(sa => sa.shiftDef.type === "leave").length;
    return {
      userId: s.id, fullName: s.fullName, category: s.category,
      dutyDays, nightDays, leaveDays, totalDaysOnDuty: dutyDays + nightDays,
    };
  });

  const avgDaysOnDuty = workload.length
    ? Math.round((workload.reduce((sum, w) => sum + w.totalDaysOnDuty, 0) / workload.length) * 10) / 10
    : 0;
  // Flag anyone notably above the group average — a cheap, real-data-driven
  // overload signal without needing a hardcoded max-days policy.
  const overloaded = workload.filter(w => w.totalDaysOnDuty > avgDaysOnDuty * 1.3);

  return { monthKey, staffCount: workload.length, avgDaysOnDuty, overloaded, workload };
}

// ── 7. Today snapshot ─────────────────────────────────────────────────────
// Total headcount, who's actually on duty today broken down by category,
// and whether today specifically has a coverage gap — the "walk up to the
// dashboard this morning" view, distinct from rosterCoverageWidget's
// whole-month violation count.
async function todayWidget(stationId) {
  const [totalStaff, monthKey] = await Promise.all([
    rosterRepo.getActiveStaffContacts(stationId).then(s => s.length),
    Promise.resolve(new Date().toISOString().slice(0, 7)),
  ]);

  const roster = await rosterRepo.findRosterByStationAndMonth(stationId, monthKey);
  const todayStr = new Date().toISOString().slice(0, 10);
  const byCategory = { B1: 0, B2: 0, CM: 0, NCS: 0, STO: 0 };
  // Every code in use today, bucketed for the Shift Distribution donut —
  // Morning/Afternoon/Night hold shiftFamily's own M/A/N buckets (which
  // already fold variant codes like M1/MS/AS in); "Others" is everything
  // shiftFamily doesn't classify (General/Break/Flexi/etc.) but that's
  // still a real on-duty assignment, not a gap in the data.
  const byShift = { M: 0, A: 0, N: 0, Others: 0 };
  let onDutyToday = 0;
  const gaps = [];

  if (roster) {
    const staff = await rosterRepo.getRosterGrid(stationId, roster.id);
    const onDutyByShift = { M: { B1: 0, B2: 0 }, A: { B1: 0, B2: 0 }, N: { B1: 0, B2: 0 } };

    for (const s of staff) {
      const todayShift = s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === todayStr);
      if (!todayShift || (todayShift.shiftDef.type !== "duty" && todayShift.shiftDef.type !== "night")) continue;
      onDutyToday++;
      if (s.category) byCategory[s.category] = (byCategory[s.category] || 0) + 1;
      // Morning/Afternoon variant codes (M1, MS, AS, ...) fold into the same
      // M/A bucket — General/Break/Flexi-type codes (shiftFamily returns
      // null) don't have a bucket at all, so they're correctly never checked.
      const shiftKey = shiftFamily(todayShift.shiftDef.code, todayShift.shiftDef.type);
      byShift[shiftKey || "Others"]++;
      if (shiftKey && s.category === "B1") onDutyByShift[shiftKey].B1++;
      if (shiftKey && s.category === "B2") onDutyByShift[shiftKey].B2++;
    }

    // Missing B1 coverage blocks a mandatory sign-off on every shift, so
    // it's flagged critical; missing B2 only matters (and is only checked)
    // on Night per the same rule rosterCoverageWidget enforces monthly.
    for (const [shiftKey, counts] of Object.entries(onDutyByShift)) {
      if (counts.B1 === 0) gaps.push({ shift: shiftKey, issue: "No B1 AME assigned", severity: "critical" });
      if (shiftKey === "N" && counts.B2 === 0) gaps.push({ shift: shiftKey, issue: "No B2 AME assigned on Night", severity: "warning" });
    }
  }

  return { date: todayStr, totalStaff, onDutyToday, byCategory, byShift, gaps };
}

// ── 8. Staff workload trend (next N days) ─────────────────────────────────
// Day-by-day on-duty vs on-leave headcount starting today — the "Staff
// Workload" bar chart's real data source. Spans a month boundary correctly
// (fetches whichever roster(s) the window actually touches); a day with no
// roster generated yet for its month simply reports 0/0, not an error, so
// the chart still renders for the days that do have data.
async function workloadTrendWidget(stationId, days = 14) {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dayList = Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
  const monthKeys = [...new Set(dayList.map(d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`))];

  const rosters = await Promise.all(monthKeys.map(mk => rosterRepo.findRosterByStationAndMonth(stationId, mk)));
  const gridByMonth = {};
  await Promise.all(rosters.map(async (roster, i) => {
    if (roster) gridByMonth[monthKeys[i]] = await rosterRepo.getRosterGrid(stationId, roster.id);
  }));

  const trend = dayList.map(d => {
    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const dateStr = d.toISOString().slice(0, 10);
    const grid = gridByMonth[monthKey] || [];
    let onDuty = 0, onLeave = 0;
    for (const s of grid) {
      const sa = s.shiftAssignments.find(x => new Date(x.shiftDate).toISOString().slice(0, 10) === dateStr);
      if (!sa) continue;
      if (sa.shiftDef.type === "duty" || sa.shiftDef.type === "night") onDuty++;
      else if (sa.shiftDef.type === "leave") onLeave++;
    }
    return { date: dateStr, onDuty, onLeave };
  });

  return { days, trend };
}

// ── 9. Stations overview ──────────────────────────────────────────────────
// Per-station snapshot for an airline-wide role's dashboard (Airline
// Admin / Super Admin) — a station-scoped caller (Station Manager and
// everyone else) simply sees their own one station, same list reused,
// never a separate code path to keep in sync.
async function stationsOverviewWidget(actor) {
  const wide = isAirlineWide(actor);
  const allStations = await stationRepo.listStations({ airlineId: actor.airlineId, isSuperAdmin: actor.roles?.includes("SUPER_ADMIN") });
  const stations = wide ? allStations : allStations.filter(s => s.id === actor.stationId);

  const now = new Date();
  const rows = await Promise.all(stations.map(async (s) => {
    const [snapshot, schedule] = await Promise.all([
      todayWidget(s.id),
      flightScheduleService.getFlightScheduleView(s.id, now.getUTCFullYear(), now.getUTCMonth() + 1).catch(() => null),
    ]);
    return {
      stationId: s.id, iataCode: s.iataCode, name: s.name,
      staffCount: snapshot.totalStaff, onDutyToday: snapshot.onDutyToday,
      flightsThisMonth: schedule?.imported ? schedule.summary.totalMovements : 0,
      coveragePct: snapshot.totalStaff > 0 ? Math.round((snapshot.onDutyToday / snapshot.totalStaff) * 100) : 0,
    };
  }));

  return { stations: rows };
}

module.exports = {
  qualificationExpiryWidget, leaveBalanceWidget, rosterCoverageWidget,
  flightCoverageWidget, dgcaComplianceWidget, staffWorkloadWidget, todayWidget,
  workloadTrendWidget, stationsOverviewWidget,
};
