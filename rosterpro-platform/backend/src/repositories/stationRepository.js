const prisma = require("../config/prisma");

// Scoped the same way user listing already is (Module 2's userController):
// SUPER_ADMIN sees every station across every airline; everyone else sees
// only their own airline's stations. A station-scoped user (most roles)
// will get back a one-item list — the frontend uses that to decide whether
// a switcher is even worth showing.
// airline.name is included so a SUPER_ADMIN's switcher (which spans every
// tenant) can group/label stations by airline — a plain airlineId is
// meaningless in a dropdown otherwise (see AirlineSwitcher.jsx).
async function listStations({ airlineId, isSuperAdmin }) {
  const stations = await prisma.station.findMany({
    where: { deletedAt: null, isActive: true, ...(isSuperAdmin ? {} : { airlineId }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, iataCode: true, airlineId: true, airline: { select: { name: true } } },
  });
  return stations.map(({ airline, ...s }) => ({ ...s, airlineName: airline.name }));
}

// Lean lookup used purely for tenancy checks (utils/stationScope.js) — an
// airline-wide actor's claimed stationId must be resolved to its REAL
// airlineId and compared against the actor's own, never trusted at face
// value. Deliberately does not filter on deletedAt/isActive: a soft-deleted
// or deactivated station still belongs to whichever airline it always did,
// and that's all this check cares about.
function findStationAirlineId(stationId) {
  return prisma.station.findUnique({ where: { id: stationId }, select: { airlineId: true } });
}

module.exports = { listStations, findStationAirlineId };
