const rateLimit = require("express-rate-limit");

// General API limit — generous, just a backstop against runaway clients/bugs.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

// Shared limit for lower-risk auth endpoints (refresh) — generous but still
// bounded.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only counts failed attempts toward the limit
  message: { error: "Too many attempts, please try again in 15 minutes" },
});

// Login: at most 5 attempts per minute per IP — the actual brute-force
// surface, so it gets its own tight, dedicated limiter rather than sharing
// authLimiter's looser 15-minute window.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many login attempts, please try again in a minute" },
});

// Password reset (both request + completion): at most 3 per hour per IP —
// prevents both reset-spam-as-harassment and brute-forcing the reset token.
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many password reset attempts, please try again in an hour" },
});

// MFA code verification — this app's OTP-equivalent (6-digit TOTP code).
// Tight enough to make brute-forcing a 6-digit code impractical, loose
// enough that a user fumbling their authenticator app isn't locked out.
const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many MFA attempts, please try again in 15 minutes" },
});

module.exports = { apiLimiter, authLimiter, loginLimiter, passwordResetLimiter, mfaLimiter };
