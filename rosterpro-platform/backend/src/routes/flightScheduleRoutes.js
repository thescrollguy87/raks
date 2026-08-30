const express = require("express");
const multer = require("multer");
const ctrl = require("../controllers/flightScheduleController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validateQuery } = require("../middleware/validate");
const { requireOwnStation } = require("../utils/stationScope");
const { flightScheduleQuerySchema } = require("../validators/flightScheduleValidators");

// Memory storage — parsed in-request (flightScheduleService), never touches
// disk. A real Turn Report + Charter workbook is small; capped generously.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = express.Router();
router.use(requireAuth);

router.get("/", requirePermission("roster", "read"), validateQuery(flightScheduleQuerySchema), requireOwnStation("query"), ctrl.getSchedule);
router.post("/import", requirePermission("roster", "update"), validateQuery(flightScheduleQuerySchema), requireOwnStation("query"), upload.single("file"), ctrl.importSchedule);

module.exports = router;
