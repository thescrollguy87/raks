const express = require("express");
const ctrl = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { authLimiter } = require("../middleware/rateLimiter");
const {
  loginSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema,
  changePasswordSchema, verifyEmailSchema, mfaVerifySchema,
} = require("../validators/authValidators");

const router = express.Router();

// ── Public ────────────────────────────────────────────────────────────────
router.post("/login", authLimiter, validate(loginSchema), ctrl.login);
router.post("/refresh", authLimiter, validate(refreshSchema), ctrl.refresh);
router.post("/logout", validate(refreshSchema), ctrl.logout);
router.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), ctrl.forgotPassword);
router.post("/reset-password", authLimiter, validate(resetPasswordSchema), ctrl.resetPassword);
router.post("/verify-email", validate(verifyEmailSchema), ctrl.verifyEmail);

// ── Requires a valid access token ───────────────────────────────────────────
router.get("/me", requireAuth, ctrl.me);
router.post("/change-password", requireAuth, validate(changePasswordSchema), ctrl.changePassword);
router.post("/resend-verification", requireAuth, ctrl.resendVerification);
router.post("/mfa/setup", requireAuth, ctrl.setupMfa);
router.post("/mfa/verify", requireAuth, validate(mfaVerifySchema), ctrl.verifyMfa);
router.post("/mfa/disable", requireAuth, ctrl.disableMfa);

module.exports = router;
