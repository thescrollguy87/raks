const express = require("express");
const ctrl = require("../controllers/rosterController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const {
  upsertShiftSchema, bulkUpsertShiftSchema, publishRosterSchema, unpublishRosterSchema, rosterQuerySchema, generateRosterSchema,
} = require("../validators/rosterValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/shift-definitions", requirePermission("shift", "read"), ctrl.shiftDefinitions);

router.get("/", requirePermission("roster", "read"), validateQuery(rosterQuerySchema), ctrl.getGrid);

router.patch("/shift", requirePermission("shift", "update"), validateQuery(rosterQuerySchema), validate(upsertShiftSchema), ctrl.upsertShift);

router.post("/shift/bulk", requirePermission("roster", "update"), validateQuery(rosterQuerySchema), validate(bulkUpsertShiftSchema), ctrl.bulkUpsertShifts);

router.post("/generate", requirePermission("roster", "update"), validate(generateRosterSchema), ctrl.generate);

router.get("/archive", requirePermission("roster", "read"), ctrl.archive);

router.post("/publish", requirePermission("roster", "publish"), validate(publishRosterSchema), ctrl.publish);

router.post("/unpublish", requirePermission("roster", "unpublish"), validate(unpublishRosterSchema), ctrl.unpublish);

module.exports = router;
