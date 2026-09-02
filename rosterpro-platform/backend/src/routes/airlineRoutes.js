const express = require("express");
const ctrl = require("../controllers/airlineController");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/rbac");

const router = express.Router();

// Deliberately gated by role, not a resource:action permission — this
// lists every tenant on the platform, so "airline:read" alone (which
// READ_ONLY_AUDITOR holds, scoped to their own airline everywhere else)
// would be exactly the kind of cross-tenant leak the multi-tenancy audit
// fixed elsewhere. Only SUPER_ADMIN, the one legitimate cross-airline
// role, can see this.
router.get("/", requireAuth, requireRole("SUPER_ADMIN"), ctrl.list);

module.exports = router;
