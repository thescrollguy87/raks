// One-time cleanup: reassigns any UserRole rows still pointing at the
// legacy SHIFT_ENGINEER / TECHNICIAN / STORE_KEEPER roles onto the new,
// more granular role set (DUTY_ENGINEER, SR_AME/AME/CM/SR_TECH/TECH/
// JR_TECH/NCS/STORES), then deletes the legacy Role rows so a follow-up
// migration can safely drop those enum values. Best-effort match by each
// person's category + designation text; anyone who doesn't cleanly match
// falls back to the closest generic role and is listed so it can be
// double-checked by hand afterward.
//
// Safe to run more than once — a role with zero remaining users is a no-op.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function pickTechRole(designation) {
  const d = (designation || "").toUpperCase();
  if (d.includes("JR") && d.includes("TECH")) return "JR_TECH";
  if (d.includes("SR") && d.includes("TECH")) return "SR_TECH";
  if (d.includes("TECH")) return "TECH";
  return "NCS";
}

function pickAmeRole(designation) {
  const d = (designation || "").toUpperCase();
  if (d.includes("SR")) return "SR_AME";
  return "AME";
}

async function remapRole(legacyName, pickTarget) {
  const legacy = await prisma.role.findFirst({
    where: { name: legacyName },
    include: { users: { include: { user: { select: { id: true, fullName: true, category: true, designation: true } } } } },
  });
  if (!legacy || legacy.users.length === 0) {
    console.log(`${legacyName}: no users to remap.`);
    return;
  }
  console.log(`${legacyName}: remapping ${legacy.users.length} user(s)...`);
  for (const ur of legacy.users) {
    const targetName = pickTarget(ur.user);
    const target = await prisma.role.findFirst({ where: { name: targetName } });
    if (!target) { console.warn(`  ! Target role ${targetName} not found — skipping ${ur.user.fullName}`); continue; }
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: ur.user.id, roleId: target.id } },
      update: {}, create: { userId: ur.user.id, roleId: target.id },
    });
    await prisma.userRole.delete({ where: { userId_roleId: { userId: ur.user.id, roleId: legacy.id } } });
    console.log(`  - ${ur.user.fullName} (${ur.user.category || "?"}, ${ur.user.designation || "?"}) -> ${targetName}`);
  }
}

async function main() {
  await remapRole("SHIFT_ENGINEER", () => "DUTY_ENGINEER");
  await remapRole("TECHNICIAN", (u) => (u.category === "CM" ? "CM" : pickTechRole(u.designation)));
  await remapRole("STORE_KEEPER", () => "STORES");
  // AME role itself is kept (still a valid granular role for plain "AME"
  // designation), but anyone whose designation reads "Sr. AME" moves to
  // the new SR_AME role — same idea, just splitting one bucket in two.
  const ameRole = await prisma.role.findFirst({
    where: { name: "AME" },
    include: { users: { include: { user: { select: { id: true, fullName: true, category: true, designation: true } } } } },
  });
  if (ameRole) {
    const seniors = ameRole.users.filter(ur => pickAmeRole(ur.user.designation) === "SR_AME");
    if (seniors.length) console.log(`AME: splitting ${seniors.length} "Sr. AME" user(s) into SR_AME...`);
    for (const ur of seniors) {
      const srAme = await prisma.role.findFirst({ where: { name: "SR_AME" } });
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: ur.user.id, roleId: srAme.id } },
        update: {}, create: { userId: ur.user.id, roleId: srAme.id },
      });
      await prisma.userRole.delete({ where: { userId_roleId: { userId: ur.user.id, roleId: ameRole.id } } });
      console.log(`  - ${ur.user.fullName} (${ur.user.designation}) -> SR_AME`);
    }
  }

  // Now safe to delete the legacy roles (their RolePermission grants cascade).
  const deleted = await prisma.role.deleteMany({ where: { name: { in: ["SHIFT_ENGINEER", "TECHNICIAN", "STORE_KEEPER"] } } });
  console.log(`Deleted ${deleted.count} legacy role row(s).`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
