// One-time bootstrap: there's no signup endpoint (by design — see README),
// so the very first user has to be created directly. Run with:
//   node scripts/create-admin.js <email> <password> <full name>
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const [email, password, ...nameParts] = process.argv.slice(2);
  const fullName = nameParts.join(" ");
  if (!email || !password || !fullName) {
    console.error("Usage: node scripts/create-admin.js <email> <password> <full name>");
    process.exit(1);
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
