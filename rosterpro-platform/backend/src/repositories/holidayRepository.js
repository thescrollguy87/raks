const prisma = require("../config/prisma");

function create({ airlineId, stationId, date, name, actorId }) {
  return prisma.holiday.create({
    data: { airlineId, stationId: stationId || null, date, name, createdById: actorId, updatedById: actorId },
  });
}

function findById(id) {
  return prisma.holiday.findUnique({ where: { id } });
}

function update(id, { date, name }, actorId) {
  return prisma.holiday.update({
    where: { id },
    data: { ...(date ? { date } : {}), ...(name ? { name } : {}), updatedById: actorId },
  });
}

function softDelete(id, actorId) {
  return prisma.holiday.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId } });
}

// Visible to a given station = airline-wide holidays (stationId null) PLUS
// that station's own — never another station's. Omitting stationId (an
// airline-wide caller with none named) returns every holiday on the
// airline, station-specific and airline-wide alike.
function list({ airlineId, stationId, from, to, page = 1, pageSize = 100 }) {
  const where = {
    deletedAt: null,
    airlineId,
    ...(stationId ? { OR: [{ stationId }, { stationId: null }] } : {}),
    ...(from ? { date: { gte: from } } : {}),
    ...(to ? { date: { lte: to } } : {}),
  };
  return Promise.all([
    prisma.holiday.count({ where }),
    prisma.holiday.findMany({
      where, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: { date: "asc" },
      include: { station: { select: { id: true, name: true, iataCode: true } } },
    }),
  ]).then(([total, items]) => ({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }));
}

module.exports = { create, findById, update, softDelete, list };
