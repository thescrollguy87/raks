const express = require("express");
const ctrl = require("../controllers/reportController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validateQuery, validate } = require("../middleware/validate");
const { requireOwnStation } = require("../utils/stationScope");
const { reportQuerySchema, emailReportSchema, baRosterQuerySchema } = require("../validators/reportValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/download", requirePermission("reports", "export"), validateQuery(reportQuerySchema), requireOwnStation("query"), ctrl.download);
router.post("/email", requirePermission("reports", "export"), validate(emailReportSchema), requireOwnStation("body"), ctrl.emailReport);
router.get("/ba-roster", requirePermission("reports", "export"), validateQuery(baRosterQuerySchema), requireOwnStation("query"), ctrl.downloadBARoster);

module.exports = router;
