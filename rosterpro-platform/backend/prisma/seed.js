// Seeds the role/permission matrix described in the spec. This is what makes
// "each role must have configurable permissions" literally true: permissions
// live in the database (role_permissions table), not in if/else checks
// scattered through the code — an Airline Admin can be given more or fewer
// permissions later via the admin UI (Module 3) without a code change.
//
// Run with: npm run prisma:seed
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// resource:action pairs. Kept flat and explicit rather than clever, so it's
// easy to audit "what can a Shift Engineer actually do" at a glance.
const PERMISSIONS = [
  // resource        action
  ["roster", "read"], ["roster", "create"], ["roster", "update"], ["roster", "publish"], ["roster", "unpublish"], ["roster", "delete"],
  ["shift", "read"], ["shift", "update"],
  ["staff", "read"], ["staff", "create"], ["staff", "update"], ["staff", "deactivate"], ["staff", "delete"],
  ["leave", "read"], ["leave", "request"], ["leave", "approve"], ["leave", "approve_reports"],
  ["qualification", "read"], ["qualification", "create"], ["qualification", "update"],
  ["license", "read"], ["license", "create"], ["license", "update"],
  ["training", "read"], ["training", "create"],
  ["store", "read"], ["store", "issue"], ["store", "receive"],
  ["audit_finding", "read"], ["audit_finding", "create"], ["audit_finding", "update"],
  ["capa", "read"], ["capa", "create"], ["capa", "update"], ["capa", "close"],
  ["flight", "read"], ["engineering_delay", "read"], ["engineering_delay", "create"],
  ["reports", "read"], ["reports", "export"],
  ["users", "read"], ["users", "create"], ["users", "update"], ["users", "assign_role"],
  ["station", "read"], ["station", "update"],
  ["airline", "read"], ["airline", "update"],
  ["audit_trail", "read"],
];

// Shared by every operational designation role (Duty Engineer, Sr. AME, AME,
// CM, Sr. Tech, Tech, Jr. Tech, NCS, Stores) — view everything relevant to
// their own work, request their own leave, no edit/approve rights anywhere.
const VIEW_ONLY_STAFF_PERMISSIONS = [
  "roster:read", "shift:read", "leave:read", "leave:request",
  "qualification:read", "license:read", "training:read", "store:read",
  "flight:read", "reports:read",
];

// Which permissions each role gets by default. READ_ONLY_AUDITOR intentionally
// gets *_read + audit_trail:read across the board and nothing else.
const ROLE_MATRIX = {
  SUPER_ADMIN: "*", // gets every permission — platform owner across all airlines
  AIRLINE_ADMIN: [
    "roster:*", "shift:*", "staff:*", "leave:*", "qualification:*", "license:*",
    "training:*", "store:*", "audit_finding:*", "capa:*", "flight:read",
    "engineering_delay:*", "reports:*", "users:*", "station:*", "audit_trail:read",
  ],
  STATION_MANAGER: [
    "roster:*", "shift:*", "staff:read", "staff:update", "leave:*",
    "qualification:read", "license:read", "training:read", "store:read",
    "audit_finding:*", "capa:*", "flight:read", "engineering_delay:*",
    "reports:*", "users:read", "station:read", "audit_trail:read",
  ],
  LMM: [ // Line Maintenance Manager
    "roster:read", "roster:update", "roster:publish", "shift:*", "staff:read",
    "leave:read", "leave:approve", "qualification:*", "license:*", "training:*",
    "store:read", "audit_finding:*", "capa:*", "flight:read",
    "engineering_delay:*", "reports:*", "audit_trail:read",
  ],
  // Can approve leave for their own direct reports (see the "reportsToId"
  // field on User / "L1 Manager" in the UI) and is otherwise view-only
  // across the whole app — never roster:update, staff:update, etc.
  SHIFT_INCHARGE: [
    "roster:read", "shift:read", "staff:read", "leave:read", "leave:approve_reports",
    "qualification:read", "license:read", "training:read", "store:read",
    "audit_finding:read", "capa:read", "flight:read", "engineering_delay:read",
    "reports:read", "users:read", "station:read", "audit_trail:read",
  ],
  // Every operational designation below gets the exact same view-only
  // permission set — read everything relevant to their own work, request
  // their own leave, edit/approve nothing. Kept as separate roles (rather
  // than collapsed into one) because "Role" is a real per-person field in
  // the Staff Registry UI, not just an internal permission tier.
  DUTY_ENGINEER: VIEW_ONLY_STAFF_PERMISSIONS,
  SR_AME: VIEW_ONLY_STAFF_PERMISSIONS,
  AME: VIEW_ONLY_STAFF_PERMISSIONS,
  CM: VIEW_ONLY_STAFF_PERMISSIONS,
  SR_TECH: VIEW_ONLY_STAFF_PERMISSIONS,
  TECH: VIEW_ONLY_STAFF_PERMISSIONS,
  JR_TECH: VIEW_ONLY_STAFF_PERMISSIONS,
  NCS: VIEW_ONLY_STAFF_PERMISSIONS,
  STORES: VIEW_ONLY_STAFF_PERMISSIONS,
  READ_ONLY_AUDITOR: [
    "roster:read", "shift:read", "staff:read", "leave:read", "qualification:read",
    "license:read", "training:read", "store:read", "audit_finding:read",
    "capa:read", "flight:read", "engineering_delay:read", "reports:read",
    "users:read", "station:read", "airline:read", "audit_trail:read",
  ],
};

function expand(entries, allPermissionKeys) {
  if (entries === "*") return [...allPermissionKeys];
  const out = new Set();
  for (const entry of entries) {
    if (entry.endsWith(":*")) {
      const resource = entry.slice(0, -2);
      allPermissionKeys.filter(k => k.startsWith(resource + ":")).forEach(k => out.add(k));
    } else {
      out.add(entry);
    }
  }
  return [...out];
}

async function main() {
  console.log("Seeding permissions...");
  const permissionRecords = [];
  for (const [resource, action] of PERMISSIONS) {
    const rec = await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      update: {},
      create: { resource, action },
    });
    permissionRecords.push(rec);
  }
  const permByKey = Object.fromEntries(permissionRecords.map(p => [`${p.resource}:${p.action}`, p]));
  const allKeys = Object.keys(permByKey);

  console.log("Seeding roles + role-permission matrix...");
  for (const roleName of Object.keys(ROLE_MATRIX)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, isSystem: true },
    });

    const keysForRole = expand(ROLE_MATRIX[roleName], allKeys);
    for (const key of keysForRole) {
      const perm = permByKey[key];
      if (!perm) { console.warn(`  ! Unknown permission key "${key}" for role ${roleName}`); continue; }
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
    console.log(`  ${roleName}: ${keysForRole.length} permissions`);
  }

  console.log("Seeding base shift definitions...");
  // Order here IS the Shift Definitions tab's display order (via sortOrder
  // below) — all Morning codes, then Afternoon, then Night, then General,
  // then the rest, exactly matching the RosterPro PWA's SHIFT_DEFS_CUSTOM
  // array order, not alphabetical (which would scatter M1/MS away from M).
  const shiftDefs = [
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
  // `update: {}` deliberately never overwrites name/color/type/etc on a
  // re-run (an admin may have hand-edited them), but sortOrder is pure
  // display order with no admin-facing edit surface, so it's always kept
  // in sync in a separate pass — safe to re-run, and fixes existing rows
  // that were seeded before this ordering existed.
  for (const [i, def] of shiftDefs.entries()) {
    await prisma.shiftDefinition.upsert({ where: { code: def.code }, update: {}, create: { ...def, sortOrder: i * 10 } });
    await prisma.shiftDefinition.update({ where: { code: def.code }, data: { sortOrder: i * 10 } });
  }

  console.log("Seeding default shift patterns and workload items for stations with staff...");
  // Ported verbatim from reference-ui/index.html's default PATTERNS and WL
  // globals — every station that already has active staff gets these as a
  // starting point for its Auto-Roster wizard (Shift Patterns / Workload
  // Input tabs), same as the reference always ships with. Only seeded once
  // per station: if a station already has any patterns/workload items
  // (self-defined or from an earlier seed run), it's left alone.
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
