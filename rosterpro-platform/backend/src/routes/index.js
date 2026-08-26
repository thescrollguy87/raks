const express = require("express");
const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const rosterRoutes = require("./rosterRoutes");
const leaveRoutes = require("./leaveRoutes");
const complianceRoutes = require("./complianceRoutes");
const toolRoutes = require("./toolRoutes");
const storeRoutes = require("./storeRoutes");
const qualityRoutes = require("./qualityRoutes");
const flightRoutes = require("./flightRoutes");
const notificationRoutes = require("./notificationRoutes");
const reportRoutes = require("./reportRoutes");
const dashboardRoutes = require("./dashboardRoutes");
const auditRoutes = require("./auditRoutes");
const stationRoutes = require("./stationRoutes");

const router = express.Router();

router.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/roster", rosterRoutes);
router.use("/leave", leaveRoutes);
router.use("/compliance", complianceRoutes); // qualifications, licenses, trainings, authorizations
router.use("/tools", toolRoutes);
router.use("/stores", storeRoutes);
router.use("/quality", qualityRoutes); // audit findings + CAPA
router.use("/flights", flightRoutes); // flights + engineering delays
router.use("/notifications", notificationRoutes);
router.use("/reports", reportRoutes); // Excel/PDF/CSV generation + email delivery
router.use("/dashboard", dashboardRoutes); // qualification expiry, leave balance, roster/flight coverage, DGCA compliance, workload
router.use("/audit", auditRoutes); // change history + activity feed
router.use("/stations", stationRoutes); // station list, for the frontend switcher

module.exports = router;
