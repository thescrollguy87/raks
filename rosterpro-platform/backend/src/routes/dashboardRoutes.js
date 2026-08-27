const express = require("express");
const ctrl = require("../controllers/dashboardController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { requireOwnStation } = require("../utils/stationScope");

const router = express.Router();
router.use(requireAuth);
router.use(requirePermission("reports", "read"));
// Every route here takes :stationId in the URL — a Station Manager (or
// anyone else not airline-wide) must not be able to read another
// station's dashboard just by changing the ID in the request. Mounted on
// the "/:stationId" prefix (not a bare .use()) specifically so Express
// actually parses that param before this middleware runs — a bare
// router.use() here would run before route matching populates req.params.
router.use("/:stationId", requireOwnStation("params"));

router.get("/:stationId/summary", ctrl.summary);
router.get("/:stationId/qualification-expiry", ctrl.qualificationExpiry);
router.get("/:stationId/leave-balance", ctrl.leaveBalance);
router.get("/:stationId/roster-coverage", ctrl.rosterCoverage);
router.get("/:stationId/flight-coverage", ctrl.flightCoverage);
router.get("/:stationId/dgca-compliance", ctrl.dgcaCompliance);
router.get("/:stationId/staff-workload", ctrl.staffWorkload);
router.get("/:stationId/today", ctrl.today);

module.exports = router;
