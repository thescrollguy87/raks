const express = require("express");
const ctrl = require("../controllers/departureAllocationController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { requireOwnStation } = require("../utils/stationScope");
const { staffQuerySchema, dayQuerySchema, manualAssignSchema } = require("../validators/departureAllocationValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/", requirePermission("roster", "read"), validateQuery(dayQuerySchema), requireOwnStation("query"), ctrl.getDay);
router.get("/staff", requirePermission("roster", "read"), validateQuery(staffQuerySchema), requireOwnStation("query"), ctrl.getStaff);
router.post("/auto-allocate", requirePermission("roster", "update"), validate(dayQuerySchema), requireOwnStation("body"), ctrl.autoAllocate);
router.post("/assign", requirePermission("roster", "update"), validate(manualAssignSchema), requireOwnStation("body"), ctrl.manualAssign);

module.exports = router;
