const express = require("express");
const ctrl = require("../controllers/storeController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { createStoreItemSchema, movementSchema } = require("../validators/storeValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/station/:stationId", requirePermission("store", "read"), ctrl.listForStation);
router.get("/station/:stationId/low-stock", requirePermission("store", "read"), ctrl.belowMinStock);
router.get("/:id/movements", requirePermission("store", "read"), ctrl.movements);
router.post("/", requirePermission("store", "receive"), validate(createStoreItemSchema), ctrl.create);
router.post("/:id/movement", requirePermission("store", "issue"), validate(movementSchema), ctrl.movement);

module.exports = router;
