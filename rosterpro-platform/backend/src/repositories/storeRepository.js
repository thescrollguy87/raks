const prisma = require("../config/prisma");

function create(data) {
  return prisma.storeItem.create({ data });
}

function findById(id) {
  return prisma.storeItem.findUnique({ where: { id } });
}

function listForStation(stationId) {
  return prisma.storeItem.findMany({ where: { stationId, deletedAt: null }, orderBy: { partNo: "asc" } });
}

function listBelowMinStock(stationId) {
  // Prisma can't compare two columns of the same row directly in `where`,
  // so this filters in application code after fetching the station's items
  // — fine at the scale of one station's parts catalog; move to raw SQL
  // ($queryRaw) if this list ever needs to run across thousands of items.
  return prisma.storeItem.findMany({ where: { stationId, deletedAt: null } })
    .then(items => items.filter(i => i.quantityOnHand < i.minStockLevel));
}

// Adjusts quantityOnHand and records the movement in one transaction, so a
// crash between the two writes can never leave stock count and movement
// history disagreeing with each other.
function adjustQuantity(storeItemId, direction, quantity, reference, note, actorId) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.storeItem.findUnique({ where: { id: storeItemId } });
    if (!item) throw new Error("NOT_FOUND");

    const delta = direction === "IN" ? quantity : -quantity;
    const newQty = item.quantityOnHand + delta;
    if (newQty < 0) throw new Error("INSUFFICIENT_STOCK");

    const updated = await tx.storeItem.update({
      where: { id: storeItemId },
      data: { quantityOnHand: newQty, updatedById: actorId, version: { increment: 1 } },
    });
    const movement = await tx.storeMovement.create({
      data: { storeItemId, direction, quantity, reference: reference || null, note: note || null, createdById: actorId },
    });
    return { item: updated, movement };
  });
}

function listMovements(storeItemId) {
  return prisma.storeMovement.findMany({ where: { storeItemId }, orderBy: { createdAt: "desc" } });
}

module.exports = { create, findById, listForStation, listBelowMinStock, adjustQuantity, listMovements };
