const prisma = require("../config/prisma");

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

module.exports = { listAirlines };
