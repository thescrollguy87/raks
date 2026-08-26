const express = require("express");
const ctrl = require("../controllers/flightController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { createFlightSchema, updateFlightStatusSchema, createDelaySchema } = require("../validators/flightValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/station/:stationId", requirePermission("flight", "read"), ctrl.listForStation);
router.get("/station/:stationId/delays", requirePermission("engineering_delay", "read"), ctrl.listDelaysForStation);
router.post("/", requirePermission("flight", "read"), validate(createFlightSchema), ctrl.create);
router.patch("/:id/status", requirePermission("flight", "read"), validate(updateFlightStatusSchema), ctrl.updateStatus);
router.post("/delays", requirePermission("engineering_delay", "create"), validate(createDelaySchema), ctrl.recordDelay);

module.exports = router;
