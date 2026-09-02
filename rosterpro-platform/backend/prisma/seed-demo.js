// Demo/dev starter data — a base set of shift definitions, plus default
// shift patterns and workload items for any station that already has
// active staff. NOT wired into any automatic deploy pipeline (see
// render.yaml and package.json's "prisma.seed", which both point at
// prisma/seed.js only) and must stay that way: this is what makes a
// brand-new airline tenant, provisioned for a real customer, start
// completely empty rather than silently inheriting Akasa's shift codes,
// rotation patterns, and workload figures. Run it by hand, only against a
// local dev or demo database:
//
//   node prisma/seed-demo.js
//
// It scopes itself to whichever airline(s) already exist in the target
// database and skips any airline/station that already has this data (safe
// to re-run), but it does NOT create a new airline itself — point it at a
// database that already has the one (dev/demo) tenant you want seeded.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Order here IS the Shift Definitions tab's display order (via sortOrder
// below) — all Morning codes, then Afternoon, then Night, then General,
// then the rest, exactly matching the RosterPro PWA's SHIFT_DEFS_CUSTOM
// array order, not alphabetical (which would scatter M1/MS away from M).
const SHIFT_DEFS = [
  { code: "M", name: "Morning", startTime: "06:30", endTime: "14:00", breakMin: 30, type: "duty", color: "#60CFFF" },
  { code: "M1", name: "Morning-1", startTime: "06:00", endTime: "13:00", breakMin: 30, type: "duty", color: "#0284C7" },
  { code: "MS", name: "Morning Stores", startTime: "06:00", endTime: "14:00", breakMin: 30, type: "duty", color: "#0EA5E9" },
  { code: "A", name: "Afternoon", startTime: "13:30", endTime: "21:30", breakMin: 30, type: "duty", color: "#5DFFA8" },
  { code: "A1", name: "Afternoon-1", startTime: "14:30", endTime: "22:30", breakMin: 30, type: "duty", color: "#16A34A" },
  { code: "A2", name: "Afternoon-2", startTime: "15:30", endTime: "23:30", breakMin: 30, type: "duty", color: "#22C55E" },
  { code: "AS", name: "Aft Stores", startTime: "14:00", endTime: "22:00", breakMin: 30, type: "duty", color: "#4ADE80" },
  { code: "N", name: "Night", startTime: "21:00", endTime: "07:00", breakMin: 60, type: "night", color: "#C39EFF" },
  { code: "N1", name: "Night-1", startTime: "20:00", endTime: "06:00", breakMin: 60, type: "night", color: "#9333EA" },
  { code: "N2", name: "Night-2", startTime: "19:30", endTime: "05:30", breakMin: 60, type: "night", color: "#A855F7" },
  { code: "N3", name: "Night-3", startTime: "19:00", endTime: "05:00", breakMin: 60, type: "night", color: "#C084FC" },
  { code: "G", name: "General", startTime: "09:00", endTime: "17:00", breakMin: 60, type: "duty", color: "#F5C542" },
  { code: "G1", name: "General-1", startTime: "10:00", endTime: "18:00", breakMin: 60, type: "duty", color: "#C2680C" },
  { code: "G2", name: "General-2", startTime: "08:00", endTime: "16:00", breakMin: 60, type: "duty", color: "#D97706" },
  { code: "BS", name: "Break Shift", type: "duty", color: "#BE185D" },
  { code: "FS", name: "Flexi Shift", type: "duty", color: "#C2410C" },
  { code: "O", name: "Off / Rest", type: "off", color: "#7A8CA3" },
  { code: "OFF", name: "Off / Rest", type: "off", color: "#64748B" },
  { code: "L", name: "Annual Leave", type: "leave", color: "#4FC3F7" },
  { code: "SL", name: "Sick Leave", type: "leave", color: "#EF5350" },
  { code: "CL", name: "Casual Leave", type: "leave", color: "#16A34A" },
  { code: "ML", name: "Medical Leave", type: "leave", color: "#EA580C" },
  { code: "LWP", name: "Leave W/O Pay", type: "leave", color: "#92400E" },
  { code: "TRG", name: "Training", type: "other", color: "#16A34A" },
  { code: "SOD", name: "Staff on Duty", type: "other", color: "#475569" },
  { code: "DEP", name: "Deputation", type: "other", color: "#C2410C" },
  { code: "PNQ", name: "Deputation PNQ", type: "other", color: "#C2410C" },
  { code: "BOM", name: "Deputation BOM", type: "other", color: "#C2410C" },
];

// Ported verbatim from reference-ui/index.html's default PATTERNS and WL
// globals — a reasonable starting point for the Auto-Roster wizard's
// Shift Patterns / Workload Input tabs, same as the reference always
// shipped with. Demo/placeholder figures, not any specific airline's real
// tuned operational numbers.
const DEFAULT_PATTERNS = [
  { code: "P1", name: "Standard 8-day", cycle: "MMAANNOO" },
  { code: "P2", name: "Night Rotation", cycle: "NNOO" },
  { code: "P3", name: "6 Morning + 1 Off", cycle: "MMMMMMO" },
  { code: "P4", name: "6 General + 1 Off", cycle: "GGGGGGO" },
  { code: "P5", name: "6 Afternoon + 1 Off", cycle: "AAAAAAO" },
  { code: "P6", name: "Stores Rotation", cycle: "G2G2G2OO" },
  { code: "P7", name: "Deputation", cycle: "DEP" },
  { code: "P8", name: "Flexi", cycle: "FS" },
];
const DEFAULT_WORKLOAD_ITEMS = [
  { section: "transit", label: "Morning Transits (06:00-14:00)", count: 6, b1: 1, b2: 0, cm: 1, ncs: 2 },
  { section: "transit", label: "Afternoon Transits (14:00-22:00)", count: 5, b1: 1, b2: 0, cm: 1, ncs: 2 },
  { section: "transit", label: "Night Transits (21:00+)", count: 3, b1: 1, b2: 1, cm: 1, ncs: 1 },
  { section: "nighthalt", label: "Layover Inspection", count: 3, b1: 1, b2: 0, cm: 1, ncs: 1 },
  { section: "nighthalt", label: "Weekly Inspection (A/W check)", count: 1, b1: 1, b2: 1, cm: 2, ncs: 2 },
  { section: "nighthalt", label: "Service Check", count: 2, b1: 1, b2: 1, cm: 1, ncs: 2 },
  { section: "nighthalt", label: "A-Check", count: 0, b1: 1, b2: 1, cm: 3, ncs: 4 },
  { section: "nighthalt", label: "AOG Recovery", count: 0, b1: 1, b2: 1, cm: 2, ncs: 3 },
  { section: "clash", label: "Peak Morning (07:00-09:00)", count: 2, b1: 1, b2: 0, cm: 0, ncs: 1 },
  { section: "task", label: "Hangar Task / Mod", count: 2, b1: 1, b2: 0, cm: 1, ncs: 2 },
  { section: "task", label: "Tool & Equipment Check", count: 4, b1: 0, b2: 0, cm: 0, ncs: 1 },
];

async function seedShiftDefsForAirline(airlineId) {
  // `update: {}` deliberately never overwrites name/color/type/etc on a
  // re-run (an admin may have hand-edited them), but sortOrder is pure
  // display order with no admin-facing edit surface, so it's always kept
  // in sync in a separate pass — safe to re-run, and fixes existing rows
  // that were seeded before this ordering existed.
  for (const [i, def] of SHIFT_DEFS.entries()) {
    await prisma.shiftDefinition.upsert({
      where: { airlineId_code: { airlineId, code: def.code } },
      update: {}, create: { ...def, airlineId, sortOrder: i * 10 },
    });
    await prisma.shiftDefinition.update({
      where: { airlineId_code: { airlineId, code: def.code } },
      data: { sortOrder: i * 10 },
    });
  }
}

async function main() {
  const airlines = await prisma.airline.findMany({ select: { id: true, name: true } });
  if (!airlines.length) {
    console.log("No airlines exist yet — nothing to seed. Create a tenant first.");
    return;
  }

  for (const airline of airlines) {
    console.log(`Seeding base shift definitions for ${airline.name}...`);
    await seedShiftDefsForAirline(airline.id);
  }

  console.log("Seeding default shift patterns and workload items for stations with staff...");
  // Only seeded once per station: if a station already has any
  // patterns/workload items (self-defined or from an earlier seed run),
  // it's left alone.
  const stationsWithStaff = await prisma.station.findMany({
    where: { users: { some: { isActive: true, deletedAt: null } } },
    select: { id: true },
  });
  for (const { id: stationId } of stationsWithStaff) {
    const [patternCount, workloadCount] = await Promise.all([
      prisma.shiftPattern.count({ where: { stationId, deletedAt: null } }),
      prisma.workloadItem.count({ where: { stationId, deletedAt: null } }),
    ]);
    if (patternCount === 0) {
      for (const p of DEFAULT_PATTERNS) {
        await prisma.shiftPattern.create({ data: { stationId, code: p.code, name: p.name, cycle: p.cycle } }).catch(() => {});
      }
    }
    if (workloadCount === 0) {
      for (const [i, w] of DEFAULT_WORKLOAD_ITEMS.entries()) {
        await prisma.workloadItem.create({ data: { stationId, ...w, sortOrder: i } }).catch(() => {});
      }
    }
  }

  console.log("Done.");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
