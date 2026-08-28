const prisma = require("../config/prisma");

async function listPaginated({ page = 1, pageSize = 20, stationId, airlineId }) {
  const where = {
    deletedAt: null,
    ...(stationId ? { stationId } : {}),
    ...(airlineId ? { airlineId } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { fullName: "asc" },
      select: {
        id: true, fullName: true, email: true, employeeId: true, category: true, designation: true,
        isActive: true, stationId: true, airlineId: true, lastLoginAt: true,
        reportsToId: true, reportsTo: { select: { id: true, fullName: true } },
        roles: { select: { role: { select: { name: true } } } },
      },
    }),
  ]);
  return {
    items: items.map(u => ({ ...u, roles: u.roles.map(r => r.role.name) })),
    total, page, pageSize, totalPages: Math.ceil(total / pageSize),
  };
}

module.exports = { listPaginated };
