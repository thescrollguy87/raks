const express = require("express");
const multer = require("multer");
const ctrl = require("../controllers/flightController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { createFlightSchema, updateFlightStatusSchema, createDelaySchema, importFlightQuerySchema } = require("../validators/flightValidators");
const { requireOwnStation } = require("../utils/stationScope");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();
router.use(requireAuth);

router.get("/station/:stationId", requirePermission("flight", "read"), requireOwnStation("params"), ctrl.listForStation);
router.get("/station/:stationId/delays", requirePermission("engineering_delay", "read"), requireOwnStation("params"), ctrl.listDelaysForStation);
router.get("/import/template", requirePermission("flight", "read"), ctrl.importTemplate);
router.post(
  "/import", requirePermission("flight", "read"), validateQuery(importFlightQuerySchema), requireOwnStation("query"),
  upload.single("file"), ctrl.importFlightSchedule
);
router.post("/", requirePermission("flight", "read"), validate(createFlightSchema), requireOwnStation("body"), ctrl.create);
router.patch("/:id/status", requirePermission("flight", "read"), validate(updateFlightStatusSchema), ctrl.updateStatus);
router.post("/delays", requirePermission("engineering_delay", "create"), validate(createDelaySchema), ctrl.recordDelay);

module.exports = router;
