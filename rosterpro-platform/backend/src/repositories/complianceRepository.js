const prisma = require("../config/prisma");

// ── Qualifications ───────────────────────────────────────────────────────────
const qualification = {
  create: (data) => prisma.qualification.create({ data }),
  findById: (id) => prisma.qualification.findUnique({ where: { id } }),
  update: (id, data) => prisma.qualification.update({ where: { id }, data }),
  softDelete: (id, actorId) => prisma.qualification.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId } }),
  listForUser: (userId) => prisma.qualification.findMany({ where: { userId, deletedAt: null }, orderBy: { expiryDate: "asc" } }),
  listExpiringWithin: (days) => {
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return prisma.qualification.findMany({
      where: { deletedAt: null, expiryDate: { lte: cutoff }, status: { not: "EXPIRED" } },
      include: { user: { select: { id: true, fullName: true, email: true, stationId: true } } },
      orderBy: { expiryDate: "asc" },
    });
  },
  updateStatus: (id, status) => prisma.qualification.update({ where: { id }, data: { status } }),
};

// ── Licenses ──────────────────────────────────────────────────────────────
const license = {
  create: (data) => prisma.license.create({ data }),
  findById: (id) => prisma.license.findUnique({ where: { id } }),
  update: (id, data) => prisma.license.update({ where: { id }, data }),
  softDelete: (id, actorId) => prisma.license.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId } }),
  listForUser: (userId) => prisma.license.findMany({ where: { userId, deletedAt: null }, orderBy: { expiryDate: "asc" } }),
  listExpiringWithin: (days) => {
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return prisma.license.findMany({
      where: { deletedAt: null, expiryDate: { lte: cutoff } },
      include: { user: { select: { id: true, fullName: true, email: true, stationId: true } } },
      orderBy: { expiryDate: "asc" },
    });
  },
};

// ── Training ──────────────────────────────────────────────────────────────
const training = {
  create: (data) => prisma.training.create({ data }),
  findById: (id) => prisma.training.findUnique({ where: { id } }),
  update: (id, data) => prisma.training.update({ where: { id }, data }),
  softDelete: (id, actorId) => prisma.training.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId } }),
  listForUser: (userId) => prisma.training.findMany({ where: { userId, deletedAt: null }, orderBy: { completedDate: "desc" } }),
};

// ── Staff authorizations ─────────────────────────────────────────────────────
const authorization = {
  create: (data) => prisma.staffAuthorization.create({ data }),
  findById: (id) => prisma.staffAuthorization.findUnique({ where: { id } }),
  update: (id, data) => prisma.staffAuthorization.update({ where: { id }, data }),
  softDelete: (id, actorId) => prisma.staffAuthorization.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId } }),
  listForUser: (userId) => prisma.staffAuthorization.findMany({ where: { userId, deletedAt: null }, orderBy: { grantedDate: "desc" } }),
};

module.exports = { qualification, license, training, authorization };
