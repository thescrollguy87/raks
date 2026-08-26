const express = require("express");
const ctrl = require("../controllers/reportController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validateQuery, validate } = require("../middleware/validate");
const { reportQuerySchema, emailReportSchema } = require("../validators/reportValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/download", requirePermission("reports", "export"), validateQuery(reportQuerySchema), ctrl.download);
router.post("/email", requirePermission("reports", "export"), validate(emailReportSchema), ctrl.emailReport);

module.exports = router;
