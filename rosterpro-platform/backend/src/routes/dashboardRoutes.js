const express = require("express");
const ctrl = require("../controllers/dashboardController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");

const router = express.Router();
router.use(requireAuth);
router.use(requirePermission("reports", "read"));

router.get("/:stationId/summary", ctrl.summary);
router.get("/:stationId/qualification-expiry", ctrl.qualificationExpiry);
router.get("/:stationId/leave-balance", ctrl.leaveBalance);
router.get("/:stationId/roster-coverage", ctrl.rosterCoverage);
router.get("/:stationId/flight-coverage", ctrl.flightCoverage);
router.get("/:stationId/dgca-compliance", ctrl.dgcaCompliance);
router.get("/:stationId/staff-workload", ctrl.staffWorkload);
router.get("/:stationId/today", ctrl.today);

module.exports = router;
