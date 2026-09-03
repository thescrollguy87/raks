const express = require("express");
const ctrl = require("../controllers/billingController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission, requireRole } = require("../middleware/rbac");

const router = express.Router();
router.use(requireAuth);

// /status is intentionally open to ANY authenticated airline-scoped user
// (not just billing:read) — the persistent trial/read-only banner (see
// BillingBanner.jsx) has to work for a Station Manager too, since read-only
// blocks their writes just as much as anyone else's and they need to know
// why. It carries no sensitive payment data (last4 only). The full Billing
// PAGE, charge history, and every payment-method action below are Airline
// Admin only — gated by billing:read/billing:manage, held by no other role
// (see prisma/seed.js). All of this must stay reachable while the tenant is
// read_only — enforced by middleware/billingGate.js exempting the
// /api/billing prefix outright, not by anything here.
router.get("/status", ctrl.getStatus);
router.get("/charges", requirePermission("billing", "read"), ctrl.getCharges);
router.post("/payment-method/order", requirePermission("billing", "manage"), ctrl.createAuthorizationOrder);
router.post("/payment-method/confirm", requirePermission("billing", "manage"), ctrl.confirmPaymentMethod);

// SUPER_ADMIN-only operational tool — see billingController.runCycleNow.
router.post("/admin/run-cycle", requireRole("SUPER_ADMIN"), ctrl.runCycleNow);

module.exports = router;
