const express = require("express");
const ctrl = require("../controllers/userController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { createUserSchema, updateUserSchema, assignRolesSchema } = require("../validators/userValidators");

const router = express.Router();
router.use(requireAuth);

router.get("/", requirePermission("users", "read"), ctrl.list);
router.post("/", requirePermission("staff", "create"), validate(createUserSchema), ctrl.create);
router.patch("/:id", requirePermission("staff", "update"), validate(updateUserSchema), ctrl.update);
router.post("/:id/deactivate", requirePermission("staff", "deactivate"), ctrl.deactivate);
router.post("/:id/reactivate", requirePermission("staff", "deactivate"), ctrl.reactivate);
router.post("/:id/roles", requirePermission("users", "assign_role"), validate(assignRolesSchema), ctrl.assignRoles);
router.delete("/:id", requirePermission("staff", "delete"), ctrl.remove);

module.exports = router;
