const express = require("express");
const multer = require("multer");
const ctrl = require("../controllers/userController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { requireOwnStation } = require("../utils/stationScope");
const { createUserSchema, updateUserSchema, assignRolesSchema, importStaffQuerySchema } = require("../validators/userValidators");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();
router.use(requireAuth);

router.get("/", requirePermission("users", "read"), ctrl.list);
router.get("/import/template", requirePermission("staff", "read"), ctrl.importTemplate);
router.post(
  "/import", requirePermission("staff", "update"), validateQuery(importStaffQuerySchema), requireOwnStation("query"),
  upload.single("file"), ctrl.importEmployeeMaster
);
router.post("/", requirePermission("staff", "create"), validate(createUserSchema), ctrl.create);
router.patch("/:id", requirePermission("staff", "update"), validate(updateUserSchema), ctrl.update);
router.post("/:id/deactivate", requirePermission("staff", "deactivate"), ctrl.deactivate);
router.post("/:id/reactivate", requirePermission("staff", "deactivate"), ctrl.reactivate);
router.post("/:id/roles", requirePermission("users", "assign_role"), validate(assignRolesSchema), ctrl.assignRoles);
router.delete("/:id", requirePermission("staff", "delete"), ctrl.remove);

module.exports = router;
