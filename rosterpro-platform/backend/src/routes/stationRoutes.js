const express = require("express");
const ctrl = require("../controllers/stationController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { createStationSchema } = require("../validators/stationValidators");

const router = express.Router();
router.get("/", requireAuth, requirePermission("station", "read"), ctrl.list);
// station:create is held by SUPER_ADMIN ("*"), AIRLINE_ADMIN, and
// STATION_MANAGER ("station:*" each) — see prisma/seed.js. A non-SUPER_ADMIN
// caller always creates the new station under their OWN airlineId
// (stationService.create ignores any airlineId in the request body for
// them), so this can add a station to an airline but never to another one.
router.post("/", requireAuth, requirePermission("station", "create"), validate(createStationSchema), ctrl.create);

module.exports = router;
