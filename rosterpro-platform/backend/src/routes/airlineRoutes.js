const express = require("express");
const ctrl = require("../controllers/airlineController");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { createAirlineSchema } = require("../validators/airlineValidators");

const router = express.Router();

// Deliberately gated by role, not a resource:action permission — this
// lists (and creates) tenants across the whole platform, so "airline:read"/
// "airline:update" alone (which READ_ONLY_AUDITOR and AIRLINE_ADMIN hold
// respectively, scoped to their own airline everywhere else) would be
// exactly the kind of cross-tenant leak/escalation the multi-tenancy audit
// fixed elsewhere. Only SUPER_ADMIN, the one legitimate cross-airline
// role, can see or use this.
router.get("/", requireAuth, requireRole("SUPER_ADMIN"), ctrl.list);
router.post("/", requireAuth, requireRole("SUPER_ADMIN"), validate(createAirlineSchema), ctrl.create);

module.exports = router;
