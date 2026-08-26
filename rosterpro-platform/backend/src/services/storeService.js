const repo = require("../repositories/storeRepository");
const userRepo = require("../repositories/userRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const notificationService = require("./notificationService");

async function createItem(body, actor, req) {
  const item = await repo.create({
    stationId: body.stationId, partNo: body.partNo, description: body.description,
    quantityOnHand: body.quantityOnHand, minStockLevel: body.minStockLevel, unit: body.unit,
    createdById: actor.sub, updatedById: actor.sub,
  });
  await auditTrail.recordCreate("StoreItem", item.id, actor, req);
  return item;
}

async function recordMovement(storeItemId, body, actor, req) {
  const before = await repo.findById(storeItemId);
  if (!before) throw ApiError.notFound("Store item not found");

  let result;
  try {
    result = await repo.adjustQuantity(storeItemId, body.direction, body.quantity, body.reference, body.note, actor.sub);
  } catch (err) {
    if (err.message === "NOT_FOUND") throw ApiError.notFound("Store item not found");
    if (err.message === "INSUFFICIENT_STOCK") {
      throw ApiError.badRequest(`Insufficient stock: ${before.quantityOnHand} on hand, cannot issue ${body.quantity}`);
    }
    throw err;
  }

  await auditTrail.recordUpdate(
    "StoreItem", storeItemId,
    { quantityOnHand: before.quantityOnHand },
    { quantityOnHand: result.item.quantityOnHand },
    actor, req, `${body.direction} ${body.quantity}${body.reference ? ` (ref: ${body.reference})` : ""}`
  );

  if (result.item.quantityOnHand < result.item.minStockLevel) {
    await auditTrail.logActivity(
      "Low stock alert", `${result.item.partNo}: ${result.item.quantityOnHand} on hand (min ${result.item.minStockLevel})`,
      actor, req
    );

    userRepo.findContactsByRoleAtStation(before.stationId, ["STATION_MANAGER", "STORE_KEEPER"])
      .then(recipients => notificationService.notifyLowStock(recipients, {
        partNo: result.item.partNo, description: result.item.description,
        quantityOnHand: result.item.quantityOnHand, minStockLevel: result.item.minStockLevel,
      }))
      .catch(err => auditTrail.logActivity("Notification error", `Low stock alert: ${err.message}`, actor, req));
  }

  return result;
}

function listForStation(stationId) {
  return repo.listForStation(stationId);
}

function listBelowMinStock(stationId) {
  return repo.listBelowMinStock(stationId);
}

function listMovements(storeItemId) {
  return repo.listMovements(storeItemId);
}

module.exports = { createItem, recordMovement, listForStation, listBelowMinStock, listMovements };
