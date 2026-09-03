const prisma = require("../config/prisma");
const billingService = require("../services/billingService");

// SUPER_ADMIN-only listing (see routes/airlineRoutes.js — gated by
// requireRole("SUPER_ADMIN"), not just a permission string, since this is
// the one place in the app that's supposed to see across every tenant).
// Station/staff counts are separate groupBy queries rather than a nested
// _count, so each can apply its own "live" filter (active stations only,
// active+non-deleted staff only) instead of counting soft-deleted rows.
async function listAirlines() {
  const [airlines, stationCounts, staffCounts] = await Promise.all([
    prisma.airline.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, icaoCode: true, iataCode: true, isActive: true, createdAt: true },
    }),
    prisma.station.groupBy({
      by: ["airlineId"],
      where: { deletedAt: null, isActive: true },
      _count: true,
    }),
    prisma.user.groupBy({
      by: ["airlineId"],
      where: { deletedAt: null, isActive: true, airlineId: { not: null } },
      _count: true,
    }),
  ]);
  const stationCountByAirline = Object.fromEntries(stationCounts.map(c => [c.airlineId, c._count]));
  const staffCountByAirline = Object.fromEntries(staffCounts.map(c => [c.airlineId, c._count]));
  return airlines.map(a => ({
    ...a,
    stationCount: stationCountByAirline[a.id] || 0,
    activeStaffCount: staffCountByAirline[a.id] || 0,
  }));
}

// Provisions a brand-new tenant in one transaction: the Airline itself,
// its first Station, and a first AIRLINE_ADMIN user at that station —
// deliberately atomic, so a failure partway through (e.g. the AIRLINE_ADMIN
// role somehow missing from the seeded role table) never leaves a
// half-created airline with no way to log into it.
async function createAirlineWithAdmin({ airline, station, admin, passwordHash, actorId }) {
  return prisma.$transaction(async (tx) => {
    const adminRole = await tx.role.findUnique({ where: { name: "AIRLINE_ADMIN" } });
    if (!adminRole) throw new Error("AIRLINE_ADMIN role not found — has the role/permission seed been run?");

    const newAirline = await tx.airline.create({
      data: {
        name: airline.name, icaoCode: airline.icaoCode.toUpperCase(),
        iataCode: airline.iataCode ? airline.iataCode.toUpperCase() : null,
        createdById: actorId, updatedById: actorId,
      },
    });
    const newStation = await tx.station.create({
      data: {
        airlineId: newAirline.id, name: station.name, iataCode: station.iataCode.toUpperCase(),
        icaoCode: station.icaoCode ? station.icaoCode.toUpperCase() : null,
        createdById: actorId, updatedById: actorId,
      },
    });
    const newAdmin = await tx.user.create({
      data: {
        airlineId: newAirline.id, stationId: newStation.id,
        fullName: admin.fullName, email: admin.email.toLowerCase(), passwordHash,
        isActive: true, isEmailVerified: true, // admin-provisioned — same rule as userService.createStaff
        createdById: actorId,
      },
    });
    await tx.userRole.create({ data: { userId: newAdmin.id, roleId: adminRole.id } });

    // Trial starts automatically, in the same transaction — no separate
    // step, no window where a tenant exists without a billing record.
    await billingService.startTrial(newAirline.id, actorId, tx);

    return { airline: newAirline, station: newStation, admin: newAdmin };
  });
}

module.exports = { listAirlines, createAirlineWithAdmin };
