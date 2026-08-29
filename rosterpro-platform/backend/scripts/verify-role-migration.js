const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const roles = await prisma.role.findMany({
    select: { name: true, _count: { select: { users: true } } },
    orderBy: { name: "asc" },
  });

  const enumRows = await prisma.$queryRawUnsafe(
    `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'RoleName' ORDER BY e.enumsortorder`
  );

  const legacyLeftover = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS c FROM user_roles ur JOIN roles r ON r.id = ur."roleId" WHERE r.name::text IN ('SHIFT_ENGINEER','TECHNICIAN','STORE_KEEPER')`
  );

  console.log("=== ROLE VERIFICATION ===");
  console.log("Roles + assigned-user counts:");
  for (const r of roles) console.log(`  ${r.name}: ${r._count.users} users`);
  console.log("RoleName enum values in DB:", enumRows.map((r) => r.enumlabel).join(", "));
  console.log("Leftover legacy-role user_roles rows:", legacyLeftover[0].c);
  console.log("=== END ===");

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
