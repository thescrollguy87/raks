const prisma = require("../config/prisma");

// Scoped the same way user listing already is (Module 2's userController):
// SUPER_ADMIN sees every station across every airline; everyone else sees
// only their own airline's stations. A station-scoped user (most roles)
// will get back a one-item list — the frontend uses that to decide whether
// a switcher is even worth showing.
function listStations({ airlineId, isSuperAdmin }) {
  return prisma.station.findMany({
    where: { deletedAt: null, isActive: true, ...(isSuperAdmin ? {} : { airlineId }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, iataCode: true, airlineId: true },
  });
}

module.exports = { listStations };
