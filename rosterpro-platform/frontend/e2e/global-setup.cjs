// Seeds a dedicated, isolated test station with 180 synthetic active staff
// (above VIRTUALIZE_STAFF_THRESHOLD in RosterPage.jsx) so the
// roster-virtualization spec can assert real windowing behavior at the
// 150-200 staff scale the user asked to cover, without depending on
// whatever real demo/dev data happens to be loaded. Idempotent — safe to
// re-run: upserts by a fixed employeeId per synthetic staff member and a
// fixed (airlineId, iataCode) for the station, so repeated CI/dev runs
// never accumulate duplicate rows.
//
// Reaches into the backend directly via Prisma (not the HTTP API) purely
// for seeding speed — 180 individual POST /api/users calls would be slow
// and each requires fields (password, role) irrelevant to what this test
// actually verifies. The spec itself only ever talks to the app through
// the browser, same as a real user.
const path = require("path");
const fs = require("fs");

const prisma = require(path.join(__dirname, "..", "..", "backend", "src", "config", "prisma.js"));
const { hashPassword } = require(path.join(__dirname, "..", "..", "backend", "src", "utils", "password.js"));

const STAFF_COUNT = 180;
const STATION_IATA = "E2E";
const MANAGER_EMAIL = "e2e.virtualization@rosterpro.test";
const MANAGER_PASSWORD = "E2ETestPass123!";
const CATEGORIES = ["B1", "B2", "CM", "NCS", "STO"];
const OUTPUT_FILE = path.join(__dirname, ".seed-output.json");

module.exports = async function globalSetup() {
  let airline = await prisma.airline.findFirst({ where: { deletedAt: null, isActive: true } });
  if (!airline) {
    airline = await prisma.airline.create({ data: { name: "E2E Test Airline", icaoCode: "E2E", isActive: true } });
  }

  let station = await prisma.station.findFirst({ where: { airlineId: airline.id, iataCode: STATION_IATA } });
  if (!station) {
    station = await prisma.station.create({
      data: { airlineId: airline.id, iataCode: STATION_IATA, name: "E2E Virtualization Test Station", timezone: "Asia/Kolkata", isActive: true },
    });
  } else if (!station.isActive) {
    station = await prisma.station.update({ where: { id: station.id }, data: { isActive: true } });
  }

  const managerRole = await prisma.role.findUnique({ where: { name: "STATION_MANAGER" } });
  if (!managerRole) throw new Error("STATION_MANAGER role not found — run `npx prisma db seed` first");

  const passwordHash = await hashPassword(MANAGER_PASSWORD);
  const manager = await prisma.user.upsert({
    where: { email: MANAGER_EMAIL },
    update: { passwordHash, stationId: station.id, airlineId: airline.id, isActive: true, deletedAt: null, isEmailVerified: true },
    create: {
      email: MANAGER_EMAIL, fullName: "E2E Virtualization Manager", passwordHash,
      stationId: station.id, airlineId: airline.id, category: "B1", designation: "Station Manager", isActive: true,
      isEmailVerified: true, // login requires this — synthetic staff below never log in, so they don't need it
    },
  });
  const hasRole = await prisma.userRole.findFirst({ where: { userId: manager.id, roleId: managerRole.id } });
  if (!hasRole) await prisma.userRole.create({ data: { userId: manager.id, roleId: managerRole.id } });

  // One shared hash for every synthetic staff row — none of them ever log
  // in, so there's no reason to pay bcrypt's deliberately-slow cost 180
  // times over for a password nothing will ever check.
  const staffPasswordHash = await hashPassword("unused-no-login-needed");
  for (let i = 1; i <= STAFF_COUNT; i++) {
    const employeeId = `E2E-${String(i).padStart(3, "0")}`;
    const category = CATEGORIES[i % CATEGORIES.length];
    await prisma.user.upsert({
      where: { employeeId },
      update: { stationId: station.id, airlineId: airline.id, isActive: true, deletedAt: null, category },
      create: {
        employeeId, fullName: `E2E Synthetic Staff ${String(i).padStart(3, "0")}`,
        email: `e2e.staff.${i}@rosterpro.test`, passwordHash: staffPasswordHash,
        stationId: station.id, airlineId: airline.id, category, designation: "AME", isActive: true,
      },
    });
  }

  // The roster grid's staff list is every active user at the station,
  // full stop — the manager logging in to view it is themselves one of
  // them (a real station manager is very often also on the roster). Query
  // the real total rather than assuming STAFF_COUNT, so the spec's
  // expectations can never drift from what the app actually shows.
  const staffCount = await prisma.user.count({ where: { stationId: station.id, isActive: true, deletedAt: null } });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
    stationId: station.id, stationIata: STATION_IATA,
    managerEmail: MANAGER_EMAIL, managerPassword: MANAGER_PASSWORD,
    staffCount,
  }, null, 2));

  await prisma.$disconnect();
};
