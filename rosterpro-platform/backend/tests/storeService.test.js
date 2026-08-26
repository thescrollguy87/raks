jest.mock("../src/repositories/storeRepository");
jest.mock("../src/utils/auditTrail");

const repo = require("../src/repositories/storeRepository");
const auditTrail = require("../src/utils/auditTrail");
const svc = require("../src/services/storeService");

const actor = { sub: "user-1", name: "Actor" };

describe("storeService.recordMovement", () => {
  it("404s when the store item doesn't exist", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(svc.recordMovement("nope", { direction: "OUT", quantity: 1 }, actor, {}))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects an OUT movement larger than quantity on hand", async () => {
    repo.findById.mockResolvedValue({ id: "item-1", partNo: "P-100", quantityOnHand: 10 });
    repo.adjustQuantity.mockRejectedValue(new Error("INSUFFICIENT_STOCK"));

    await expect(svc.recordMovement("item-1", { direction: "OUT", quantity: 999 }, actor, {}))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("applies a valid movement and records the audit trail", async () => {
    repo.findById.mockResolvedValue({ id: "item-1", partNo: "P-100", quantityOnHand: 10, minStockLevel: 5 });
    repo.adjustQuantity.mockResolvedValue({
      item: { id: "item-1", partNo: "P-100", quantityOnHand: 3, minStockLevel: 5 },
      movement: { id: "mv-1" },
    });

    const result = await svc.recordMovement("item-1", { direction: "OUT", quantity: 7 }, actor, {});

    expect(result.item.quantityOnHand).toBe(3);
    expect(auditTrail.recordUpdate).toHaveBeenCalledWith(
      "StoreItem", "item-1", { quantityOnHand: 10 }, { quantityOnHand: 3 }, actor, {}, expect.any(String)
    );
  });

  it("fires a low-stock alert when the resulting quantity is below minStockLevel", async () => {
    repo.findById.mockResolvedValue({ id: "item-1", partNo: "P-100", quantityOnHand: 10, minStockLevel: 5 });
    repo.adjustQuantity.mockResolvedValue({
      item: { id: "item-1", partNo: "P-100", quantityOnHand: 3, minStockLevel: 5 },
      movement: { id: "mv-1" },
    });

    await svc.recordMovement("item-1", { direction: "OUT", quantity: 7 }, actor, {});

    expect(auditTrail.logActivity).toHaveBeenCalledWith("Low stock alert", expect.stringContaining("P-100"), actor, {});
  });

  it("does NOT fire a low-stock alert when comfortably above minStockLevel", async () => {
    repo.findById.mockResolvedValue({ id: "item-1", partNo: "P-100", quantityOnHand: 100, minStockLevel: 5 });
    repo.adjustQuantity.mockResolvedValue({
      item: { id: "item-1", partNo: "P-100", quantityOnHand: 90, minStockLevel: 5 },
      movement: { id: "mv-1" },
    });

    await svc.recordMovement("item-1", { direction: "OUT", quantity: 10 }, actor, {});

    expect(auditTrail.logActivity).not.toHaveBeenCalledWith("Low stock alert", expect.anything(), expect.anything(), expect.anything());
  });
});
