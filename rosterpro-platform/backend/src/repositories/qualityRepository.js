const prisma = require("../config/prisma");

const finding = {
  create: (data) => prisma.auditFinding.create({ data }),
  findById: (id) => prisma.auditFinding.findUnique({ where: { id }, include: { capas: true } }),
  update: (id, data) => prisma.auditFinding.update({ where: { id }, data }),
  listForStation: (stationId, status) => prisma.auditFinding.findMany({
    where: { stationId, deletedAt: null, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    include: { raisedBy: { select: { fullName: true } }, capas: { select: { id: true, status: true } } },
  }),
  listOverdue: () => prisma.auditFinding.findMany({
    where: { deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: new Date() } },
    include: {
      station: { select: { name: true, iataCode: true } },
      raisedBy: { select: { id: true, fullName: true, email: true, phone: true } },
    },
  }),
};

const capa = {
  create: (data) => prisma.capa.create({ data }),
  findById: (id) => prisma.capa.findUnique({ where: { id } }),
  update: (id, data) => prisma.capa.update({ where: { id }, data }),
  listForFinding: (findingId) => prisma.capa.findMany({ where: { findingId }, orderBy: { createdAt: "desc" } }),
  listForOwner: (ownerId, status) => prisma.capa.findMany({
    where: { ownerId, deletedAt: null, ...(status ? { status } : {}) },
    orderBy: { targetDate: "asc" },
  }),
  listOverdue: () => prisma.capa.findMany({
    where: { deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] }, targetDate: { lt: new Date() } },
    include: { owner: { select: { id: true, fullName: true, email: true, phone: true } } },
  }),
};

module.exports = { finding, capa };
