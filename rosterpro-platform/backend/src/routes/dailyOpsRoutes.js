const express = require("express");
const ctrl = require("../controllers/dailyOpsController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { requireOwnStation } = require("../utils/stationScope");
const { monthQuerySchema, createAdjustmentSchema } = require("../validators/dailyOpsValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/", requirePermission("roster", "read"), validateQuery(monthQuerySchema), requireOwnStation("query"), ctrl.listAdjustments);
router.post("/", requirePermission("roster", "update"), validate(createAdjustmentSchema), requireOwnStation("body"), ctrl.createAdjustment);
router.delete("/:id", requirePermission("roster", "update"), ctrl.deleteAdjustment);
router.get("/comparison", requirePermission("roster", "read"), validateQuery(monthQuerySchema), requireOwnStation("query"), ctrl.getComparison);

module.exports = router;
