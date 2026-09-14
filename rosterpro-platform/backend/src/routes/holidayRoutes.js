const express = require("express");
const ctrl = require("../controllers/holidayController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { createHolidaySchema, updateHolidaySchema, holidayQuerySchema } = require("../validators/holidayValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/", requirePermission("holiday", "read"), validateQuery(holidayQuerySchema), ctrl.list);
router.post("/", requirePermission("holiday", "manage"), validate(createHolidaySchema), ctrl.create);
router.put("/:id", requirePermission("holiday", "manage"), validate(updateHolidaySchema), ctrl.update);
router.delete("/:id", requirePermission("holiday", "manage"), ctrl.remove);

module.exports = router;
