const express = require("express");
const ctrl = require("../controllers/attendanceController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { punchSchema, attendanceQuerySchema, overviewQuerySchema } = require("../validators/attendanceValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/today", requirePermission("attendance", "punch"), ctrl.today);
router.post("/punch-in", requirePermission("attendance", "punch"), validate(punchSchema), ctrl.punchIn);
router.post("/punch-out", requirePermission("attendance", "punch"), validate(punchSchema), ctrl.punchOut);
router.get("/overview", requirePermission("attendance", "read"), validateQuery(overviewQuerySchema), ctrl.overview);
router.get("/", requirePermission("attendance", "read"), validateQuery(attendanceQuerySchema), ctrl.list);

module.exports = router;
