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
  ["staff", "read"], ["staff", "create"], ["staff", "update"], ["staff", "deactivate"],
  ["leave", "read"], ["leave", "request"], ["leave", "approve"],
  ["qualification", "read"], ["qualification", "create"], ["qualification", "update"],
  ["license", "read"], ["license", "create"], ["license", "update"],
  ["training", "read"], ["training", "create"],
  ["tool", "read"], ["tool", "issue"], ["tool", "return"], ["tool", "calibrate"],
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

// Which permissions each role gets by default. READ_ONLY_AUDITOR intentionally
// gets *_read + audit_trail:read across the board and nothing else.
const ROLE_MATRIX = {
  SUPER_ADMIN: "*", // gets every permission — platform owner across all airlines
  AIRLINE_ADMIN: [
    "roster:*", "shift:*", "staff:*", "leave:*", "qualification:*", "license:*",
    "training:*", "tool:*", "store:*", "audit_finding:*", "capa:*", "flight:read",
    "engineering_delay:*", "reports:*", "users:*", "station:*", "audit_trail:read",
  ],
  STATION_MANAGER: [
    "roster:*", "shift:*", "staff:read", "staff:update", "leave:*",
    "qualification:read", "license:read", "training:read", "tool:*", "store:read",
    "audit_finding:*", "capa:*", "flight:read", "engineering_delay:*",
    "reports:*", "users:read", "station:read", "audit_trail:read",
  ],
  LMM: [ // Line Maintenance Manager
    "roster:read", "roster:update", "roster:publish", "shift:*", "staff:read",
    "leave:read", "leave:approve", "qualification:*", "license:*", "training:*",
    "tool:read", "store:read", "audit_finding:*", "capa:*", "flight:read",
    "engineering_delay:*", "reports:*", "audit_trail:read",
  ],
  SHIFT_ENGINEER: [
    "roster:read", "shift:read", "shift:update", "staff:read", "leave:read",
    "qualification:read", "license:read", "tool:read", "tool:issue", "tool:return",
    "store:read", "audit_finding:read", "audit_finding:create", "flight:read",
    "engineering_delay:create", "engineering_delay:read", "reports:read",
  ],
  AME: [
    "roster:read", "shift:read", "leave:request", "leave:read",
    "qualification:read", "license:read", "training:read",
    "tool:read", "tool:issue", "tool:return", "store:read", "flight:read",
  ],
  TECHNICIAN: [
    "roster:read", "shift:read", "leave:request", "leave:read",
    "qualification:read", "training:read", "tool:read", "tool:issue", "tool:return", "store:read",
  ],
  STORE_KEEPER: [
    "roster:read", "leave:request", "leave:read",
    "store:*", "tool:read", "tool:calibrate",
  ],
  READ_ONLY_AUDITOR: [
    "roster:read", "shift:read", "staff:read", "leave:read", "qualification:read",
    "license:read", "training:read", "tool:read", "store:read", "audit_finding:read",
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
  const shiftDefs = [
    { code: "M", name: "Morning", startTime: "06:30", endTime: "14:00", breakMin: 30, type: "duty", color: "#60CFFF" },
    { code: "A", name: "Afternoon", startTime: "13:30", endTime: "21:30", breakMin: 30, type: "duty", color: "#5DFFA8" },
    { code: "N", name: "Night", startTime: "21:00", endTime: "07:00", breakMin: 60, type: "night", color: "#C39EFF" },
    { code: "G", name: "General", startTime: "09:00", endTime: "17:00", breakMin: 60, type: "duty", color: "#F5C542" },
    { code: "O", name: "Off / Rest", type: "off", color: "#7A8CA3" },
    { code: "L", name: "Annual Leave", type: "leave", color: "#4FC3F7" },
    { code: "SL", name: "Sick Leave", type: "leave", color: "#EF5350" },
  ];
  for (const def of shiftDefs) {
    await prisma.shiftDefinition.upsert({ where: { code: def.code }, update: {}, create: def });
  }

  console.log("Done.");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
