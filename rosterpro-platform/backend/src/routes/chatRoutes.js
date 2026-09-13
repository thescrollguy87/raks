const express = require("express");
const ctrl = require("../controllers/chatController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate, validateQuery } = require("../middleware/validate");
const { askSchema, logQuerySchema } = require("../validators/chatValidators");

const router = express.Router();
router.use(requireAuth);

// Deliberately NOT gated with requireOwnStation middleware — a request for
// a station the caller can't access is a normal, answerable chat outcome
// ("you don't have access, switch stations"), not an HTTP error the
// generic error handler should format. chatAssistantService.askAssistant
// enforces the exact same assertOwnStation check itself and returns that
// outcome as a normal 200 response for the widget to render distinctly.
// Anyone who can read a roster can ask about it.
router.post("/ask", requirePermission("roster", "read"), validate(askSchema), ctrl.ask);

// Same permission + station-scoping contract as GET /api/audit/trail.
router.get("/log", requirePermission("audit_trail", "read"), validateQuery(logQuerySchema), ctrl.listLog);

module.exports = router;
