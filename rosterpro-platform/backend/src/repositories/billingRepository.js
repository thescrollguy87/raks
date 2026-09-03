const prisma = require("../config/prisma");

function getByAirlineId(airlineId) {
  return prisma.airlineBilling.findUnique({ where: { airlineId } });
}

function getById(id) {
  return prisma.airlineBilling.findUnique({ where: { id } });
}

function create(data) {
  return prisma.airlineBilling.create({ data });
}

function update(id, data) {
  return prisma.airlineBilling.update({ where: { id }, data });
}

// Every active user on the airline counts, regardless of which station
// they're at — the whole point of "each airline is billed independently"
// is that this is an airline-wide total, not per-station.
function countActiveStaff(airlineId) {
  return prisma.user.count({ where: { airlineId, isActive: true, deletedAt: null } });
}

function findAdminsForAirline(airlineId) {
  return prisma.user.findMany({
    where: {
      airlineId, isActive: true, deletedAt: null,
      roles: { some: { role: { name: "AIRLINE_ADMIN" } } },
    },
    select: { id: true, fullName: true, email: true, phone: true },
  });
}

function createCharge(data) {
  return prisma.billingCharge.create({ data });
}

function listCharges(billingId, limit = 50) {
  return prisma.billingCharge.findMany({
    where: { billingId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// Already logged a charge attempt for this billing row today? Guards the
// daily job against double-processing the same tenant if it's ever run
// more than once on the same calendar day (a manual re-run while
// debugging, a cron misfire) — idempotent-ish without needing a
// distributed lock.
async function findChargeAttemptToday(billingId, dayStart, dayEnd) {
  return prisma.billingCharge.findFirst({
    where: { billingId, createdAt: { gte: dayStart, lt: dayEnd } },
    orderBy: { createdAt: "desc" },
  });
}

// The daily job's two candidate sets: tenants whose monthly anchor has
// arrived (trialing or active, ordinary cycle), and tenants mid-grace-period
// who need a retry today regardless of their anchor date. Kept separate so
// billingService can reason about "which kind of processing is this" rather
// than re-deriving it from raw fields every time.
function listDueForCycle(now) {
  return prisma.airlineBilling.findMany({
    where: {
      status: { in: ["trialing", "active"] },
      graceEndsAt: null, // in-grace tenants are handled by listInGracePeriod instead
      nextBillingDate: { lte: now },
    },
  });
}

function listInGracePeriod(now) {
  return prisma.airlineBilling.findMany({
    where: { status: "active", graceEndsAt: { not: null } },
  });
}

module.exports = {
  getByAirlineId, getById, create, update,
  countActiveStaff, findAdminsForAirline,
  createCharge, listCharges, findChargeAttemptToday,
  listDueForCycle, listInGracePeriod,
};
