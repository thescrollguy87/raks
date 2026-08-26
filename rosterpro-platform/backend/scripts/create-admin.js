// One-time bootstrap: there's no signup endpoint (by design — see README),
// so the very first user has to be created directly. Run with:
//   node scripts/create-admin.js <email> <password> <full name>
// or, so it's safe to run unattended on every deploy (see render.yaml),
// set ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME as env vars instead — with
// neither CLI args nor those env vars set, this exits quietly (0) rather
// than failing the build, since most deploys shouldn't create/reset an
// account.
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const [argEmail, argPassword, ...argNameParts] = process.argv.slice(2);
  const email = argEmail || process.env.ADMIN_EMAIL;
  const password = argPassword || process.env.ADMIN_PASSWORD;
  const fullName = (argNameParts.length ? argNameParts.join(" ") : process.env.ADMIN_NAME) || "Admin";

  if (!email || !password) {
    console.log("No ADMIN_EMAIL/ADMIN_PASSWORD set (or CLI args given) — skipping admin bootstrap.");
    return;
  }

  const role = await prisma.role.findFirst({ where: { name: "SUPER_ADMIN" } });
  if (!role) {
    console.error("SUPER_ADMIN role not found — run `npx prisma db seed` first.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, fullName, isEmailVerified: true, isActive: true },
    create: { email, passwordHash, fullName, isEmailVerified: true, isActive: true },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });

  console.log(`SUPER_ADMIN ready: ${user.email}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
