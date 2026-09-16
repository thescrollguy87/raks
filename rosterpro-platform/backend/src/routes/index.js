const express = require("express");
const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const rosterRoutes = require("./rosterRoutes");
const leaveRoutes = require("./leaveRoutes");
const holidayRoutes = require("./holidayRoutes");
const officeLocationRoutes = require("./officeLocationRoutes");
const attendanceRoutes = require("./attendanceRoutes");
const regularizationRoutes = require("./regularizationRoutes");
const complianceRoutes = require("./complianceRoutes");
const flightRoutes = require("./flightRoutes");
const notificationRoutes = require("./notificationRoutes");
const reportRoutes = require("./reportRoutes");
const dashboardRoutes = require("./dashboardRoutes");
const auditRoutes = require("./auditRoutes");
const stationRoutes = require("./stationRoutes");
const flightScheduleRoutes = require("./flightScheduleRoutes");
const workloadConfigRoutes = require("./workloadConfigRoutes");
const ruleBuilderRoutes = require("./ruleBuilderRoutes");
const dailyOpsRoutes = require("./dailyOpsRoutes");
const departureAllocationRoutes = require("./departureAllocationRoutes");
const airlineRoutes = require("./airlineRoutes");
const billingRoutes = require("./billingRoutes");
const chatRoutes = require("./chatRoutes");

const router = express.Router();

router.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/roster", rosterRoutes);
router.use("/leave", leaveRoutes);
router.use("/holidays", holidayRoutes);
router.use("/office-locations", officeLocationRoutes); // Geolocation Attendance: geofences a punch can land inside
router.use("/attendance", attendanceRoutes); // Geolocation Attendance: punch in/out, today's context, records list
router.use("/regularization", regularizationRoutes); // Geolocation Attendance: missing/late-punch regularization, routed through the same L1 Manager approval as Leave
router.use("/compliance", complianceRoutes); // qualifications, licenses, trainings, authorizations
router.use("/flights", flightRoutes); // flights + engineering delays
router.use("/notifications", notificationRoutes);
router.use("/reports", reportRoutes); // Excel/PDF/CSV generation + email delivery
router.use("/dashboard", dashboardRoutes); // qualification expiry, leave balance, roster/flight coverage, DGCA compliance, workload
router.use("/audit", auditRoutes); // change history + activity feed
router.use("/stations", stationRoutes); // station list, for the frontend switcher
router.use("/flight-schedule", flightScheduleRoutes); // Auto-Roster Generator: Turn Report / Charter import
router.use("/workload-config", workloadConfigRoutes); // Auto-Roster Generator: Workload Config tab
router.use("/rule-builder", ruleBuilderRoutes); // Auto-Roster Generator: Rule Builder tab (staff groups + rules)
router.use("/daily-ops", dailyOpsRoutes); // Auto-Roster Generator: Daily Operational Adjustment tab
router.use("/departure-allocation", departureAllocationRoutes); // Flight Schedule page: day-wise per-departure manpower (releaser + support)
router.use("/airlines", airlineRoutes); // SUPER_ADMIN-only: every tenant on the platform, with station/staff counts
router.use("/billing", billingRoutes); // per-seat Razorpay subscription: status, payment method, charge history
router.use("/chat", chatRoutes); // Roster Assistant: natural-language Q&A backed by real tool calls (Gemini)

module.exports = router;
