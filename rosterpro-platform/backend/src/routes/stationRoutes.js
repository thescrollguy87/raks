const express = require("express");
const ctrl = require("../controllers/stationController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { createStationSchema } = require("../validators/stationValidators");

const router = express.Router();
router.get("/", requireAuth, requirePermission("station", "read"), ctrl.list);
// station:create is only held by SUPER_ADMIN ("*") and AIRLINE_ADMIN
// ("station:*") — see prisma/seed.js — so this can never be reached by a
// station-scoped role.
router.post("/", requireAuth, requirePermission("station", "create"), validate(createStationSchema), ctrl.create);

module.exports = router;
