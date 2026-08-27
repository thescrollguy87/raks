const express = require("express");
const multer = require("multer");
const ctrl = require("../controllers/rosterController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { requireOwnStation } = require("../utils/stationScope");
const {
  upsertShiftSchema, bulkUpsertShiftSchema, publishRosterSchema, unpublishRosterSchema, rosterQuerySchema, generateRosterSchema, archiveQuerySchema,
} = require("../validators/rosterValidators");

// Memory storage — the file is parsed in-request (rosterImportService) and
// never needs to touch disk; capped well above any realistic roster export.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();
router.use(requireAuth);

router.get("/shift-definitions", requirePermission("shift", "read"), ctrl.shiftDefinitions);

router.get("/", requirePermission("roster", "read"), validateQuery(rosterQuerySchema), requireOwnStation("query"), ctrl.getGrid);

router.patch("/shift", requirePermission("shift", "update"), validateQuery(rosterQuerySchema), requireOwnStation("query"), validate(upsertShiftSchema), ctrl.upsertShift);

router.post("/shift/bulk", requirePermission("roster", "update"), validateQuery(rosterQuerySchema), requireOwnStation("query"), validate(bulkUpsertShiftSchema), ctrl.bulkUpsertShifts);

router.post("/generate", requirePermission("roster", "update"), validate(generateRosterSchema), requireOwnStation("body"), ctrl.generate);

router.get("/archive", requirePermission("roster", "read"), validateQuery(archiveQuerySchema), requireOwnStation("query"), ctrl.archive);

router.post("/import", requirePermission("roster", "update"), validateQuery(rosterQuerySchema), requireOwnStation("query"), upload.single("file"), ctrl.importRoster);

router.post("/publish", requirePermission("roster", "publish"), validate(publishRosterSchema), ctrl.publish);

router.post("/unpublish", requirePermission("roster", "unpublish"), validate(unpublishRosterSchema), ctrl.unpublish);

module.exports = router;
