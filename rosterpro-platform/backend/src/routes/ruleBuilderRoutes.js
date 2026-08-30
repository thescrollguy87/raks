const express = require("express");
const ctrl = require("../controllers/ruleBuilderController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { requireOwnStation } = require("../utils/stationScope");
const { stationQuerySchema, upsertStaffGroupSchema, upsertRuleSchema } = require("../validators/ruleBuilderValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/staff-groups", requirePermission("roster", "read"), validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.listStaffGroups);
router.put("/staff-groups", requirePermission("roster", "update"), validate(upsertStaffGroupSchema), requireOwnStation("body"), ctrl.upsertStaffGroup);
router.delete("/staff-groups/:id", requirePermission("roster", "update"), ctrl.deleteStaffGroup);

router.get("/", requirePermission("roster", "read"), validateQuery(stationQuerySchema), requireOwnStation("query"), ctrl.listRules);
router.put("/", requirePermission("roster", "update"), validate(upsertRuleSchema), requireOwnStation("body"), ctrl.upsertRule);
router.delete("/:id", requirePermission("roster", "update"), ctrl.deleteRule);

module.exports = router;
