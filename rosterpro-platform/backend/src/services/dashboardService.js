const rosterRepo = require("../repositories/rosterRepository");
const complianceRepo = require("../repositories/complianceRepository");
const flightRepo = require("../repositories/flightRepository");
const complianceService = require("./complianceService");
const leaveService = require("./leaveService");
const ApiError = require("../utils/ApiError");

// ── 1. Qualification expiry ──────────────────────────────────────────────

async function qualificationExpiryWidget(stationId, windowDays = 30) {
  const staff = await rosterRepo.getActiveStaffContacts(stationId);
  const staffIds = new Set(staff.map(s => s.id));

  const [expiringQuals, expiringLicenses] = await Promise.all([
    complianceRepo.qualification.listExpiringWithin(windowDays),
    complianceRepo.license.listExpiringWithin(windowDays),
  ]);
  // Station-scope the results — the repo queries are global, filter here.
  const quals = expiringQuals.filter(q => staffIds.has(q.userId));
  const licenses = expiringLicenses.filter(l => staffIds.has(l.userId));

  const now = new Date();
  const countByStatus = (items) => ({
    expired: items.filter(i => i.expiryDate < now).length,
    expiring: items.filter(i => i.expiryDate >= now).length,
  });

  return {
    qualifications: { ...countByStatus(quals), items: quals },
    licenses: { ...countByStatus(licenses), items: licenses },
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
      const dateStr = new Date(sa.shiftDate).toISOString().slice(0, 10);
      const shiftKey = sa.shiftDef.type === "night" ? "N" : sa.shiftDef.code; // M/A codes as-is, any night-type code counts as N
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
      if (counts.B1 === 0) violations.push({ date: dateStr, shift: shiftKey, issue: "No B1 AME assigned" });
      if (shiftKey === "N" && counts.B2 === 0) violations.push({ date: dateStr, shift: shiftKey, issue: "No B2 AME assigned on Night" });
    }
  }

  return {
    monthKey, isPublished: roster.isPublished,
    daysWithData: Object.keys(byDate).length,
    violationCount: violations.length, violations,
    dailyBreakdown: byDate,
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

  return {
    from, to,
    totalFlights: flights.length,
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

  const blockedStaff = staff.filter((s, i) => summaries[i].isBlocked);
  return {
    totalActiveStaff: staff.length,
    blockedStaffCount: blockedStaff.length,
    blockedStaff: blockedStaff.map((s, i) => ({ id: s.id, fullName: s.fullName })),
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
      const shiftKey = todayShift.shiftDef.type === "night" ? "N" : todayShift.shiftDef.code;
      if (onDutyByShift[shiftKey] && s.category === "B1") onDutyByShift[shiftKey].B1++;
      if (onDutyByShift[shiftKey] && s.category === "B2") onDutyByShift[shiftKey].B2++;
    }

    for (const [shiftKey, counts] of Object.entries(onDutyByShift)) {
      if (counts.B1 === 0) gaps.push({ shift: shiftKey, issue: "No B1 AME assigned" });
      if (shiftKey === "N" && counts.B2 === 0) gaps.push({ shift: shiftKey, issue: "No B2 AME assigned on Night" });
    }
  }

  return { date: todayStr, totalStaff, onDutyToday, byCategory, gaps };
}

module.exports = {
  qualificationExpiryWidget, leaveBalanceWidget, rosterCoverageWidget,
  flightCoverageWidget, dgcaComplianceWidget, staffWorkloadWidget, todayWidget,
};
