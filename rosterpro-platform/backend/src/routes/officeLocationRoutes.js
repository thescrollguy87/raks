const express = require("express");
const ctrl = require("../controllers/officeLocationController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { createOfficeLocationSchema, updateOfficeLocationSchema, officeLocationQuerySchema } = require("../validators/officeLocationValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/", requirePermission("attendance", "read"), validateQuery(officeLocationQuerySchema), ctrl.list);
router.post("/", requirePermission("attendance", "manage"), validate(createOfficeLocationSchema), ctrl.create);
router.put("/:id", requirePermission("attendance", "manage"), validate(updateOfficeLocationSchema), ctrl.update);
router.delete("/:id", requirePermission("attendance", "manage"), ctrl.remove);

module.exports = router;
