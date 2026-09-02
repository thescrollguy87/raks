// First-run bootstrap for a brand new deployment. Two independent parts:
//
// 1. Ensures at least one Station exists. There is currently no way to
//    create a Station through the app itself (no POST /api/stations
//    endpoint, no frontend form for it) — a database with zero stations
//    leaves Dashboard/Roster/etc with nothing to scope to, which used to
//    make those screens spin forever (see DashboardPage.jsx /
//    RosterPage.jsx — fixed to show a message instead, but there's still
//    nothing useful to show without at least one real station). Always
//    runs, and is a no-op the moment ANY station exists anywhere — this
//    is a whole-platform genesis bootstrap (creates the very first
//    tenant, once, for a database that has none), not a per-tenant
//    default: it never fires again once a second airline is added, so it
//    never attaches anything to a new tenant the way seed-demo.js/
//    seed-stations.js deliberately must not either.
//
// 2. Creates/updates one SUPER_ADMIN login — there's no signup endpoint
//    (by design — see README) so the very first user has to be created
//    directly. Run with:
//      node scripts/create-admin.js <email> <password> <full name>
//    or, so it's safe to run unattended on every deploy (see render.yaml),
//    set ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME as env vars instead —
//    with neither CLI args nor those env vars set, this part is skipped
//    rather than failing the build, since most deploys shouldn't
//    create/reset an account.
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function ensureDefaultStation() {
  const existing = await prisma.station.findFirst();
  if (existing) return;

  const airline = await prisma.airline.upsert({
    where: { icaoCode: "DEFAULT" },
    update: {},
    create: { name: "Default Airline", icaoCode: "DEFAULT", iataCode: "DF" },
  });
  const station = await prisma.station.create({
    data: { airlineId: airline.id, iataCode: "AMD", name: "Ahmedabad Line Maintenance" },
  });
  console.log(`No stations existed — created a default one: ${station.name} (${station.iataCode}). Rename/replace it once you have real station data.`);
}

async function ensureAdmin() {
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

async function main() {
  await ensureDefaultStation();
  await ensureAdmin();
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
